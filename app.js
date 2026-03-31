const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const placeholder = document.getElementById("placeholder");
const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");
const laughScoreEl = document.getElementById("laughScore");
const happyScoreEl = document.getElementById("happyScore");
const mouthScoreEl = document.getElementById("mouthScore");

const ctx = overlay.getContext("2d");

let cameraStream = null;
let running = false;
let modelReady = false;
let animationHandle = null;
let lastFrameAt = 0;
let processingFrame = false;
let lastSnapshotKey = "";
let lastSnapshotAt = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(label, detail, tone = "neutral") {
  statusEl.textContent = label;
  detailEl.textContent = detail;
  statusEl.style.color =
    tone === "good" ? "var(--accent)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--danger)" : "var(--text)";
}

function setMetricState(metricEl, tone) {
  metricEl.classList.remove("good", "warn", "bad");
  if (tone) metricEl.classList.add(tone);
}

function updateMetrics(laughScore, happyScore, mouthScore, tone) {
  laughScoreEl.textContent = `${Math.round(laughScore * 100)}%`;
  happyScoreEl.textContent = `${Math.round(happyScore * 100)}%`;
  mouthScoreEl.textContent = `${Math.round(mouthScore * 100)}%`;
  setMetricState(laughScoreEl.parentElement, tone);
  setMetricState(happyScoreEl.parentElement, tone === "bad" ? "bad" : tone === "warn" ? "warn" : "good");
  setMetricState(mouthScoreEl.parentElement, tone === "good" ? "good" : tone === "warn" ? "warn" : "bad");
}

function postLiveSnapshot(snapshot) {
  const payload = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
  const key = JSON.stringify(payload);
  const now = Date.now();
  if (key === lastSnapshotKey && now - lastSnapshotAt < 1000) {
    return;
  }

  lastSnapshotKey = key;
  lastSnapshotAt = now;

  fetch("/api/live", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error("Failed to post live snapshot", error);
  });
}

function mouthOpenRatio(landmarks) {
  const mouth = landmarks.getMouth();
  const xs = mouth.map((point) => point.x);
  const ys = mouth.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!width) return 0;
  return height / width;
}

function assessLaugh(expressions, landmarks) {
  const happy = expressions.happy ?? 0;
  const mouthRatio = mouthOpenRatio(landmarks);
  const mouthOpen = clamp((mouthRatio - 0.14) / 0.18, 0, 1);
  const laughScore = happy * 0.68 + mouthOpen * 0.32;

  if (laughScore > 0.72 && happy > 0.45 && mouthOpen > 0.35) {
    return {
      label: "Laughing",
      detail: `Expression looks like laughter. Happy ${Math.round(happy * 100)}%, mouth open ${Math.round(mouthOpen * 100)}%.`,
      tone: "good",
      laughScore,
      happy,
      mouthOpen,
    };
  }

  if (happy > 0.35 || mouthOpen > 0.22) {
    return {
      label: "Possibly laughing",
      detail: `There is a smile-like expression. Happy ${Math.round(happy * 100)}%, mouth open ${Math.round(mouthOpen * 100)}%.`,
      tone: "warn",
      laughScore,
      happy,
      mouthOpen,
    };
  }

  return {
    label: "Not laughing",
    detail: `No strong laughter signal. Happy ${Math.round(happy * 100)}%, mouth open ${Math.round(mouthOpen * 100)}%.`,
    tone: "bad",
    laughScore,
    happy,
    mouthOpen,
  };
}

async function loadModels() {
  if (modelReady) return;
  setStatus("Loading", "Downloading the face-expression model.", "warn");
  startBtn.disabled = true;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
  ]);
  modelReady = true;
  startBtn.disabled = false;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Unsupported", "This browser does not support camera capture.", "bad");
    return;
  }

  await loadModels();

  cameraStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
    },
  });

  video.srcObject = cameraStream;
  await video.play();
  placeholder.classList.add("hidden");
  setStatus("Scanning", "Looking for a laughing face in the live feed.", "good");
  running = true;
  loop();
}

async function loop(timestamp = 0) {
  if (!running) return;

  animationHandle = requestAnimationFrame(loop);
  if (!video.videoWidth || !video.videoHeight) return;
  if (timestamp - lastFrameAt < 220) return;
  if (processingFrame) return;

  processingFrame = true;
  lastFrameAt = timestamp;

  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.45,
    });

    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceExpressions();

    const displaySize = {
      width: video.clientWidth,
      height: video.clientHeight,
    };

    faceapi.matchDimensions(overlay, displaySize);
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!detections.length) {
      setStatus("No face", "Move into view and face the camera.", "warn");
      updateMetrics(0, 0, 0, "warn");
      postLiveSnapshot({
        status: "No face",
        detail: "Move into view and face the camera.",
        tone: "warn",
        laughScore: 0,
        happyScore: 0,
        mouthOpenScore: 0,
        faceCount: 0,
      });
      return;
    }

    const analyzed = detections.map((detection) => {
      const laugh = assessLaugh(detection.expressions, detection.landmarks);
      return { detection, laugh };
    });

    const primary = analyzed.reduce((best, current) => (current.laugh.laughScore > best.laugh.laughScore ? current : best));
    const { label, detail, tone, laughScore, happy, mouthOpen } = primary.laugh;
    setStatus(label, detail, tone);
    updateMetrics(laughScore, happy, mouthOpen, tone);
    postLiveSnapshot({
      status: label,
      detail,
      tone,
      laughScore,
      happyScore: happy,
      mouthOpenScore: mouthOpen,
      faceCount: detections.length,
    });

    const resized = faceapi.resizeResults(detections, displaySize);
    resized.forEach((result, index) => {
      const laugh = analyzed[index].laugh;
      const { x, y, width, height } = result.detection.box;
      ctx.strokeStyle =
        laugh.tone === "good"
          ? "rgba(124, 231, 197, 0.98)"
          : laugh.tone === "warn"
            ? "rgba(255, 203, 119, 0.98)"
            : "rgba(255, 122, 144, 0.98)";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      ctx.fillStyle = "rgba(8, 16, 31, 0.88)";
      ctx.fillRect(x, Math.max(0, y - 34), 150, 28);
      ctx.fillStyle = "rgba(244, 247, 251, 0.96)";
      ctx.font = "600 14px Inter, sans-serif";
      ctx.fillText(laugh.label, x + 10, Math.max(18, y - 15));
    });
  } catch (error) {
    console.error(error);
    setStatus("Error", "The detector hit a browser-side error.", "bad");
    postLiveSnapshot({
      status: "Error",
      detail: "The detector hit a browser-side error.",
      tone: "bad",
      laughScore: 0,
      happyScore: 0,
      mouthOpenScore: 0,
      faceCount: 0,
    });
  } finally {
    processingFrame = false;
  }
}

async function shutdown() {
  running = false;
  if (animationHandle) cancelAnimationFrame(animationHandle);
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

startBtn.addEventListener("click", async () => {
  try {
    startBtn.disabled = true;
    await startCamera();
  } catch (error) {
    console.error(error);
    placeholder.classList.remove("hidden");
    setStatus("Camera blocked", "Allow camera access and try again.", "bad");
    detailEl.textContent = error?.message || "Unable to access the webcam.";
    startBtn.disabled = false;
  }
});

window.addEventListener("beforeunload", shutdown);

setStatus("Idle", "Camera is off.");
updateMetrics(0, 0, 0, "bad");
postLiveSnapshot({
  status: "Idle",
  detail: "Camera is off.",
  tone: "neutral",
  laughScore: 0,
  happyScore: 0,
  mouthOpenScore: 0,
  faceCount: 0,
});
