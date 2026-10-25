const MODEL_URL = "./model/";
let model, webcam, maxPredictions;
let modelLoaded = false;
let webcamStarted = false;
let poseLoopStarted = false;
let currentPrediction = null;
let startupStage = "kamera";

const CONFIDENCE_THRESHOLD = 0.7; // 70%
const CHALLENGE_POSES = ["ATTACK", "DEFEND", "DODGE"];
const CHALLENGE_EMOJI = {
  ATTACK: "⚔️ ATTACK!",
  DEFEND: "🛡️ DEFEND!",
  DODGE: "💨 DODGE!",
};

// Level configuration: waktu (detik) & berapa kali benar untuk naik level
const LEVELS = {
  1: { name: "1 - ROOKIE", time: 5, correctToLevelUp: 5 },
  2: { name: "2 - APPRENTICE", time: 3, correctToLevelUp: 5 },
  3: { name: "3 - MASTER NINJA", time: 2, correctToLevelUp: 5 },
};

// Game state
let score = 0;
let hp = 3;
let combo = 0;
let bestCombo = 0;
let level = 1;
let correctInLevel = 0;
let currentChallenge = null;
let challengeActive = false;
let timeLeft = 0;
let timerInterval = null;
let checkInterval = null;
let bossMode = false;
let bossSequence = [];
let bossIndex = 0;
let gameEnded = false;

// ---------- 1 & 2. LOAD MODEL & WEBCAM ----------
async function initModel() {
  startupStage = "kamera";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("secure-context");
  }

  if (!webcamStarted) {
    webcam = new tmPose.Webcam(300, 300, true);
    await webcam.setup();
    startupStage = "menyalakan kamera";
    await webcam.play();
    document.getElementById("webcam-container").appendChild(webcam.canvas);
    webcamStarted = true;
    webcam.canvas.setAttribute("aria-label", "Pratinjau kamera");
  }

  if (!poseLoopStarted) {
    poseLoopStarted = true;
    window.requestAnimationFrame(poseLoop);
  }

  if (!modelLoaded) {
    startupStage = "memuat model AI";
    const modelURL = MODEL_URL + "model.json";
    const metadataURL = MODEL_URL + "metadata.json";
    model = await tmPose.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();
    modelLoaded = true;
  }

  return true;
}

function getStartupErrorMessage(error) {
  const errorMessage = error?.message ?? String(error ?? "Error tidak diketahui");
  const errorName = error?.name ?? "";

  if (errorMessage === "secure-context") {
    return "Kamera hanya bisa dipakai lewat localhost atau HTTPS. Jalankan halaman dengan Live Server.";
  }
  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    return "Izin kamera ditolak. Izinkan akses kamera di pengaturan situs, lalu coba lagi.";
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "Kamera tidak ditemukan. Sambungkan atau aktifkan kamera, lalu coba lagi.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut, lalu coba lagi.";
  }
  return "Gagal " + startupStage + ": " + errorMessage;
}

// ---------- 3 & 4 & 5. BACA POSE & PREDICTION REALTIME ----------
async function poseLoop() {
  try {
    if (webcamStarted) {
      webcam.update();
    }
    if (modelLoaded) {
      await predict();
    }
  } catch (err) {
    // Kalau ada error di satu frame, jangan sampai loop berhenti total.
    // Buka Console (F12) untuk lihat detail error ini kalau webcam masih freeze.
    console.error("Pose loop error:", err);
  }
  if (webcamStarted) {
    window.requestAnimationFrame(poseLoop);
  } else {
    poseLoopStarted = false;
  }
}

async function predict() {
  const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
  const prediction = await model.predict(posenetOutput);

  // 6. Tentukan class dengan confidence tertinggi
  let best = prediction[0];
  for (let i = 1; i < prediction.length; i++) {
    if (prediction[i].probability > best.probability) {
      best = prediction[i];
    }
  }

  currentPrediction = best;

  document.getElementById("prediction-text").innerText = best.className;
  document.getElementById("confidence-text").innerText =
    Math.round(best.probability * 100) + "%";
}

// ---------- COUNTDOWN 3-2-1 FIGHT ----------
function countdown() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("countdown-overlay");
    overlay.classList.remove("hidden");
    let count = 3;
    overlay.innerText = count;

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        overlay.innerText = count;
      } else if (count === 0) {
        overlay.innerText = "FIGHT!";
      } else {
        clearInterval(interval);
        overlay.classList.add("hidden");
        resolve();
      }
    }, 800);
  });
}

// ---------- 7. RANDOM CHALLENGE ----------
function getRandomChallenge() {
  return CHALLENGE_POSES[Math.floor(Math.random() * CHALLENGE_POSES.length)];
}

function shuffleBossSequence() {
  const seq = [];
  for (let i = 0; i < 5; i++) {
    seq.push(getRandomChallenge());
  }
  return seq;
}

// ---------- 8. TIMER PER CHALLENGE ----------
function nextChallenge() {
  if (gameEnded) return;

  if (hp <= 0) {
    return gameOver();
  }

  // Tentukan pose yang harus dilakukan pemain
  if (bossMode) {
    if (bossIndex >= bossSequence.length) {
      return victory();
    }
    currentChallenge = bossSequence[bossIndex];
    document.getElementById("challenge-text").innerText =
      "👹 " + CHALLENGE_EMOJI[currentChallenge];
  } else {
    currentChallenge = getRandomChallenge();
    document.getElementById("challenge-text").innerText =
      CHALLENGE_EMOJI[currentChallenge];
  }

  challengeActive = true;
  timeLeft = LEVELS[level].time;
  document.getElementById("timer-value").innerText = timeLeft;
  document.getElementById("result-text").innerText = "";

  clearInterval(timerInterval);
  clearInterval(checkInterval);

  // 9. Timer mundur setiap detik
  timerInterval = setInterval(() => {
    timeLeft--;
    document.getElementById("timer-value").innerText = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      clearInterval(checkInterval);
      if (challengeActive) {
        challengeActive = false;
        onFail("💥 TOO SLOW!");
      }
    }
  }, 1000);

  // Cek pose pemain beberapa kali per detik selama challenge aktif
  checkInterval = setInterval(checkAnswer, 200);
}

// ---------- 10. BANDINGKAN CHALLENGE DENGAN HASIL AI ----------
function checkAnswer() {
  if (!challengeActive || !currentPrediction) return;

  const matches = currentPrediction.className === currentChallenge;
  const confident = currentPrediction.probability >= CONFIDENCE_THRESHOLD;

  if (matches && confident) {
    challengeActive = false;
    clearInterval(timerInterval);
    clearInterval(checkInterval);
    onCorrect();
  } else if (!confident) {
    document.getElementById("result-text").innerText =
      "🤔 AI belum yakin, coba lagi!";
  }
}

// ---------- 11 & 12 & 13. SCORE, HP, COMBO ----------
function onCorrect() {
  combo++;
  bestCombo = Math.max(bestCombo, combo);
  correctInLevel++;

  const basePoints = level === 3 || bossMode ? 20 : 10;
  const comboBonus = combo % 3 === 0 ? 10 : 0;
  score += basePoints + comboBonus;

  const icon = CHALLENGE_EMOJI[currentChallenge].split(" ")[0];
  let msg = icon + " PERFECT! +" + basePoints + " POINT";
  if (comboBonus > 0) {
    msg += "  🔥 COMBO x" + combo + " (+" + comboBonus + ")";
  }
  document.getElementById("result-text").innerText = msg;

  updateStatusBar();

  if (bossMode) {
    bossIndex++;
    return setTimeout(nextChallenge, 1200);
  }

  // 14. Cek kenaikan level
  if (correctInLevel >= LEVELS[level].correctToLevelUp) {
    if (level < 3) {
      level++;
      correctInLevel = 0;
      document.getElementById("result-text").innerText =
        "⬆️ LEVEL UP! " + LEVELS[level].name;
      updateStatusBar();
      return setTimeout(nextChallenge, 1600);
    } else {
      // Selesai level 3, masuk Final Boss
      bossMode = true;
      bossSequence = shuffleBossSequence();
      bossIndex = 0;
      document.getElementById("result-text").innerText =
        "👹 FINAL BOSS APPEARS!";
      return setTimeout(nextChallenge, 1600);
    }
  }

  setTimeout(nextChallenge, 1000);
}

function onFail(reason) {
  combo = 0;
  hp--;
  updateStatusBar();

  document.getElementById("result-text").innerText = reason + " -1 HP";

  if (hp <= 0) {
    return setTimeout(gameOver, 800);
  }
  setTimeout(nextChallenge, 1200);
}

function updateStatusBar() {
  document.getElementById("level-value").innerText = LEVELS[level].name;
  document.getElementById("score-value").innerText = score;
  document.getElementById("combo-value").innerText = "x" + combo;
  document.getElementById("hp-value").innerText =
    "❤️".repeat(hp) + "🖤".repeat(3 - hp);
}

function showFinalSummary() {
  document.getElementById("best-combo-value").innerText = "x" + bestCombo;
  document.getElementById("final-score-value").innerText = score;
  document.getElementById("final-summary").classList.remove("hidden");
}

// ---------- 15 & 16. GAME OVER & VICTORY ----------
function gameOver() {
  gameEnded = true;
  clearInterval(timerInterval);
  clearInterval(checkInterval);
  document.getElementById("challenge-text").innerText = "💀";
  document.getElementById("result-text").innerText =
    "💀 GAME OVER — SCORE: " + score;
  showFinalSummary();
  document.getElementById("start-btn").innerText = "🔄 TRY AGAIN";
  document.getElementById("start-btn").disabled = false;
}

function victory() {
  gameEnded = true;
  clearInterval(timerInterval);
  clearInterval(checkInterval);
  document.getElementById("challenge-text").innerText = "🏆";
  document.getElementById("result-text").innerText =
    "🏆 NINJA MASTER! SCORE: " + score;
  showFinalSummary();
  document.getElementById("start-btn").innerText = "🔄 PLAY AGAIN";
  document.getElementById("start-btn").disabled = false;
}

function resetGame() {
  score = 0;
  hp = 3;
  combo = 0;
  bestCombo = 0;
  level = 1;
  correctInLevel = 0;
  bossMode = false;
  bossSequence = [];
  bossIndex = 0;
  gameEnded = false;
  challengeActive = false;
  document.getElementById("final-summary").classList.add("hidden");
  updateStatusBar();
}

// ---------- START BUTTON ----------
document.getElementById("start-btn").addEventListener("click", async () => {
  const btn = document.getElementById("start-btn");
  btn.disabled = true;

  try {
    if (!modelLoaded) {
      document.getElementById("result-text").innerText = "⏳ Mengaktifkan kamera dan menyiapkan AI...";
      await initModel();
    }

    resetGame();
    btn.innerText = "⚔️ IN BATTLE...";
    await countdown();
    nextChallenge();
  } catch (error) {
    console.error("Gagal memulai game:", error);
    document.getElementById("result-text").innerText = getStartupErrorMessage(error);
    btn.innerText = "🔄 COBA LAGI";
    btn.disabled = false;
  }
});