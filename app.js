/* ─── State ─────────────────────────────────────────────────────── */
const state = {
  manifest: null,
  navPath: [], // array of node objects representing the navigation path
  testMeta: null, // { id, label, path }
  exam: null, // loaded JSON { topic, questions }
  answers: [], // [{ selected: [...keys], submitted: bool }]
  current: 0,
  feedbackOpen: [], // [bool]
  user: null, // Firebase user object (null = not authenticated)
  authMode: "signin", // 'signin' or 'signup'
};

/* ─── Session Persistence (localStorage + Firestore) ──────────── */
function sessionKey() {
  if (state.navPath.length === 0 || !state.testMeta) return null;
  const pathIds = state.navPath.map((n) => n.id).join("_");
  return `cert_session_${pathIds}_${state.testMeta.id}`;
}

async function saveSession() {
  const key = sessionKey();
  if (!key) return;
  const data = {
    answers: state.answers,
    current: state.current,
    feedbackOpen: state.feedbackOpen,
    timestamp: Date.now(),
  };
  // Always save to localStorage as fallback
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    /* quota exceeded — ignore */
  }
  // If authenticated, also save to Firestore
  if (state.user && window.firestoreSetDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      await window.firestoreSetDoc(docRef, data);
    } catch (e) {
      /* network error — localStorage fallback is fine */
    }
  }
}

async function loadSession() {
  const key = sessionKey();
  if (!key) return null;
  // If authenticated, try Firestore first
  if (state.user && window.firestoreGetDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      const snap = await window.firestoreGetDoc(docRef);
      if (snap.exists()) return snap.data();
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function clearSession() {
  const key = sessionKey();
  if (!key) return;
  localStorage.removeItem(key);
  // If authenticated, also clear from Firestore
  if (state.user && window.firestoreDeleteDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      await window.firestoreDeleteDoc(docRef);
    } catch (e) {
      /* ignore */
    }
  }
}

/* ─── Auth UI ───────────────────────────────────────────────────── */
function showAuthHeader(user) {
  const header = $("auth-header");
  const emailEl = $("auth-user-email");
  if (user) {
    // Display username (part before @)
    const username = user.email.split("@")[0];
    emailEl.textContent = username;
    header.classList.remove("hidden");
  } else {
    header.classList.add("hidden");
    emailEl.textContent = "";
  }
}

function showAuthView() {
  showView("auth");
  setBreadcrumb([]);
  state.authMode = "signin";
  updateAuthForm();
}

function updateAuthForm() {
  const submitBtn = $("auth-submit-btn");
  const toggleBtn = $("auth-toggle-btn");
  const errorEl = $("auth-error");
  errorEl.classList.add("hidden");
  if (state.authMode === "signin") {
    submitBtn.textContent = "Sign In";
    toggleBtn.textContent = "Create Account";
  } else {
    submitBtn.textContent = "Create Account";
    toggleBtn.textContent = "Back to Sign In";
  }
}

function toggleAuthMode() {
  state.authMode = state.authMode === "signin" ? "signup" : "signin";
  updateAuthForm();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const errorEl = $("auth-error");
  const submitBtn = $("auth-submit-btn");

  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Loading...";

  try {
    if (state.authMode === "signup") {
      await window.firebaseSignUp(email, password);
    } else {
      await window.firebaseSignIn(email, password);
    }
    // Auth state listener will handle the redirect
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err.code);
    errorEl.classList.remove("hidden");
    submitBtn.disabled = false;
    updateAuthForm();
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
  };
  return map[code] || `Authentication error: ${code}`;
}

async function handleLogout() {
  try {
    await window.firebaseSignOut();
  } catch (e) {
    /* ignore */
  }
}

async function handleForgotPassword() {
  const email = $("auth-email").value.trim();
  const errorEl = $("auth-error");
  if (!email) {
    errorEl.textContent =
      "Enter your email address above, then click Forgot password.";
    errorEl.classList.remove("hidden");
    return;
  }
  try {
    await window.firebaseResetPassword(email);
    errorEl.textContent = "Password reset email sent. Check your inbox.";
    errorEl.classList.remove("hidden");
    errorEl.style.color = "#16a34a";
    errorEl.style.background = "#f0fdf4";
    errorEl.style.borderColor = "#dcfce7";
  } catch (err) {
    errorEl.style.color = "";
    errorEl.style.background = "";
    errorEl.style.borderColor = "";
    errorEl.textContent = friendlyAuthError(err.code);
    errorEl.classList.remove("hidden");
  }
}

function skipAuth() {
  renderHome();
}

/* ─── Firebase Auth State Listener ──────────────────────────────── */
window.onFirebaseAuthStateChanged = function (user) {
  state.user = user || null;
  showAuthHeader(user);
  // If user just signed in and we're on the auth view, go home
  const authView = $("view-auth");
  if (user && !authView.classList.contains("hidden")) {
    renderHome();
  }
};

/* ─── Helpers ───────────────────────────────────────────────────── */
function $(id) {
  return document.getElementById(id);
}

function showView(name) {
  ["home", "topic", "tests", "exam", "report", "auth", "history"].forEach(
    (v) => {
      $(`view-${v}`).classList.toggle("hidden", v !== name);
    },
  );
}

function setBreadcrumb(crumbs) {
  // crumbs: [{ label, action? }]  — last item has no action
  const nav = $("breadcrumb");
  if (!crumbs.length) {
    nav.classList.add("hidden");
    return;
  }
  nav.classList.remove("hidden");
  nav.innerHTML = crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      if (isLast) return `<span class="current">${c.label}</span>`;
      return `<a onclick="${c.action}">${c.label}</a><span class="sep">›</span>`;
    })
    .join("");
}

function toLabel(id) {
  // "virtual-machines" → "Virtual Machines", already handled by manifest
  return id;
}

function countCorrect(question, selected) {
  if (!selected || selected.length === 0) return false;
  const correct = new Set(question.correct);
  const sel = new Set(selected);
  return correct.size === sel.size && [...correct].every((k) => sel.has(k));
}

function requiredCount(question) {
  // parse "Select TWO" / "Select THREE" from stem
  // applies to both type='multi' and type='scenario' with multi-select stems
  if (question.type === "single") return 1;
  const m = question.stem.match(/select\s+(two|three)/i);
  if (!m) return question.correct.length;
  return m[1].toLowerCase() === "two" ? 2 : 3;
}

/* ─── Fetch helpers ─────────────────────────────────────────────── */
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/* ─── HOME VIEW ─────────────────────────────────────────────────── */
async function renderHome() {
  showView("home");
  state.navPath = [];
  setBreadcrumb([]);
  const el = $("view-home");
  el.innerHTML = `
    <h1 class="page-title">Certification Practice</h1>
    <p class="page-subtitle">Select a certification to begin</p>
    <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
    <div class="state-msg">Loading...</div>`;

  try {
    state.manifest = await fetchJSON("manifest.json");
  } catch (e) {
    el.innerHTML = `
      <h1 class="page-title">Certification Practice</h1>
      <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
      <div class="state-msg error">Could not load manifest.json.<br>${e.message}</div>`;
    return;
  }

  const providers = state.manifest.providers;
  if (!providers || providers.length === 0) {
    el.innerHTML = `
      <h1 class="page-title">Certification Practice</h1>
      <div class="state-msg">No certifications found in manifest.json.</div>`;
    return;
  }

  el.innerHTML = `
    <h1 class="page-title">Certification Practice</h1>
    <p class="page-subtitle">Select a certification to begin</p>
    <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
    ${
      !state.user
        ? '<p class="auth-prompt"><a href="#" onclick="showAuthView(); return false;">Sign in</a> to sync progress across devices</p>'
        : ""
    }
    <div class="home-actions">
      <button class="btn btn-secondary btn-sm" onclick="renderHistory()">History</button>
    </div>
    <div class="card-grid">
      ${providers
        .map(
          (p) => `
        <div class="card" onclick="navigateTo('${p.id}', 0)">
          <div class="card-title">${p.label}</div>
          <div class="card-meta">${nodeMetaText(p)}</div>
          ${
            p.description ? `<div class="card-desc">${p.description}</div>` : ""
          }
        </div>`,
        )
        .join("")}
    </div>`;
}

/* ─── NAVIGATION HELPERS ────────────────────────────────────────── */
function countTests(node) {
  let count = 0;
  if (node.tests) count += node.tests.length;
  if (node.children) node.children.forEach((c) => (count += countTests(c)));
  return count;
}

function nodeMetaText(node) {
  // Show the immediate children count with appropriate label
  // If node has children, describe them (topics, domains, tasks, etc.)
  // If node is a leaf (tests only), show test count
  const hasChildren = node.children && node.children.length > 0;
  const hasTests = node.tests && node.tests.length > 0;

  if (hasChildren) {
    const count = node.children.length;
    // Infer the child type from the first child's id
    const firstChildId = node.children[0].id || "";
    let unit = "topic";
    if (firstChildId.startsWith("domain")) unit = "domain";
    else if (firstChildId.startsWith("task")) unit = "task";
    return `${count} ${unit}${count !== 1 ? "s" : ""}`;
  }

  if (hasTests) {
    const count = node.tests.length;
    return `${count} test${count !== 1 ? "s" : ""}`;
  }

  return "";
}

function findNodeAtDepth(depth, id) {
  // depth 0 = top-level providers
  if (depth === 0) {
    return state.manifest.providers.find((p) => p.id === id);
  }
  // Otherwise, look within the current navPath's last node's children
  const parent = state.navPath[depth - 1];
  if (!parent || !parent.children) return null;
  return parent.children.find((c) => c.id === id);
}

function navigateTo(id, depth) {
  const node = findNodeAtDepth(depth, id);
  if (!node) return;

  // Trim navPath to depth and push the new node
  state.navPath = state.navPath.slice(0, depth);
  state.navPath.push(node);

  renderNode();
}

function navigateToDepth(depth) {
  // Navigate back to a specific depth in the breadcrumb
  state.navPath = state.navPath.slice(0, depth + 1);
  renderNode();
}

/* ─── NODE VIEW (replaces topic + test list) ────────────────────── */
function renderNode() {
  const node = state.navPath[state.navPath.length - 1];
  const hasChildren = node.children && node.children.length > 0;
  const hasTests = node.tests && node.tests.length > 0;

  // Build breadcrumb
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    if (i < state.navPath.length - 1) {
      crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
    } else {
      crumbs.push({ label: n.label });
    }
  });
  setBreadcrumb(crumbs);

  // If node has only tests (leaf), show test list
  if (hasTests && !hasChildren) {
    renderTestList(node);
    return;
  }

  // If node has only children, show children cards
  // If node has both, show children cards + tests below
  showView("topic");
  let html = `<h1 class="page-title">${node.label}</h1>`;

  if (hasChildren) {
    html += `<p class="page-subtitle">Select a topic</p>`;
    html += `<div class="card-grid">`;
    html += node.children
      .map(
        (c) => `
      <div class="card" onclick="navigateTo('${c.id}', ${
        state.navPath.length
      })">
        <div class="card-title">${c.label}</div>
        <div class="card-meta">${nodeMetaText(c)}</div>
        ${c.description ? `<div class="card-desc">${c.description}</div>` : ""}
      </div>`,
      )
      .join("");
    html += `</div>`;
  }

  if (hasTests) {
    html += `<div class="section-heading" style="margin-top:28px">Tests</div>`;
    html += buildTestListHTML(node.tests);
  }

  $("view-topic").innerHTML = html;
}

function buildTestListHTML(tests) {
  return `<div class="test-list">
    ${tests
      .map(
        (t) => `
      <div class="test-row" id="row-${t.id}">
        <span class="test-row-label">${t.label}</span>
        <button class="btn btn-primary btn-sm" onclick="startTest('${t.id}')">Start</button>
      </div>`,
      )
      .join("")}
  </div>`;
}

function renderTestList(node) {
  showView("tests");

  // Breadcrumb already set by renderNode caller
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    if (i < state.navPath.length - 1) {
      crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
    } else {
      crumbs.push({ label: n.label });
    }
  });
  setBreadcrumb(crumbs);

  $("view-tests").innerHTML = `
    <h1 class="page-title">${node.label}</h1>
    <p class="page-subtitle">Choose a test to begin</p>
    ${buildTestListHTML(node.tests)}`;
}

async function startTest(id) {
  const currentNode = state.navPath[state.navPath.length - 1];
  state.testMeta = currentNode.tests.find((t) => t.id === id);
  const row = $(`row-${id}`);
  const btn = row.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    state.exam = await fetchJSON(state.testMeta.path);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Start";
    const err = document.createElement("div");
    err.className = "test-row-error";
    err.textContent = `Error: ${e.message}`;
    row.appendChild(err);
    return;
  }

  // Check for saved session
  const saved = await loadSession();
  if (saved && saved.answers && saved.answers.some((a) => a.submitted)) {
    // Show resume prompt
    const answeredCount = saved.answers.filter((a) => a.submitted).length;
    const total = state.exam.questions.length;
    row.innerHTML = `
      <div class="resume-prompt">
        <p class="resume-msg">You have a saved session (${answeredCount}/${total} answered). Resume where you left off?</p>
        <div class="resume-actions">
          <button class="btn btn-primary btn-sm" onclick="resumeTest()">Resume</button>
          <button class="btn btn-secondary btn-sm" onclick="startFresh()">Start Fresh</button>
        </div>
      </div>`;
    return;
  }

  // Init fresh exam state
  initFreshExam();
}

async function resumeTest() {
  const saved = await loadSession();
  if (saved) {
    state.answers = saved.answers;
    state.current = saved.current;
    state.feedbackOpen =
      saved.feedbackOpen || new Array(state.exam.questions.length).fill(false);
  }
  renderExam();
}

function startFresh() {
  clearSession();
  initFreshExam();
}

function initFreshExam() {
  const n = state.exam.questions.length;
  state.answers = Array.from({ length: n }, () => ({
    selected: [],
    submitted: false,
  }));
  state.feedbackOpen = new Array(n).fill(false);
  state.current = 0;
  saveSession();
  renderExam();
}

/* ─── EXAM VIEW ─────────────────────────────────────────────────── */
function renderExam() {
  showView("exam");
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
  });
  crumbs.push({
    label: state.testMeta.label,
    action: `navigateToDepth(${state.navPath.length - 1})`,
  });
  crumbs.push({ label: `Q${state.current + 1}` });
  setBreadcrumb(crumbs);
  renderQuestion(state.current);
}

function renderQuestion(idx) {
  const q = state.exam.questions[idx];
  const ans = state.answers[idx];
  const total = state.exam.questions.length;
  const req = requiredCount(q);
  const isLast = idx === total - 1;

  // Header
  const header = `
    <div class="exam-header">
      <span class="exam-progress">Question ${idx + 1} of ${total}</span>
      <span class="domain-badge">${q.domain}</span>
    </div>`;

  // Scenario
  const scenario = q.scenario
    ? `<div class="scenario-block">${q.scenario}</div>`
    : "";

  // Multi-select instruction (multi type, or scenario with multiple correct answers)
  const isMulti = q.type === "multi" || (q.type === "scenario" && req > 1);
  const instruction = isMulti
    ? `<div class="select-instruction">Select ${
        req === 2 ? "TWO" : "THREE"
      }</div>`
    : "";

  // Input type: checkbox for any question requiring multiple selections
  const inputType = isMulti ? "checkbox" : "radio";

  // Options
  const optionsHTML = q.options
    .map((opt) => {
      const isSelected = ans.selected.includes(opt.key);
      const isCorrect = q.correct.includes(opt.key);

      let stateClass = "";
      let missedHTML = "";
      let inputChecked = isSelected ? "checked" : "";
      let lockedAttr = ans.submitted ? "disabled" : "";

      if (ans.submitted) {
        if (isCorrect && isSelected) stateClass = "correct-selected";
        else if (!isCorrect && isSelected) stateClass = "incorrect-selected";
        else if (isCorrect && !isSelected) {
          stateClass = "correct-missed";
          missedHTML = `<div class="missed-label">Missed Correct Answer</div>`;
        }
      }

      const changeHandler = ans.submitted
        ? ""
        : `onchange="handleSelect(${idx}, '${opt.key}', this)"`;

      return `
      <li class="option-item ${stateClass} ${ans.submitted ? "locked" : ""}"
          onclick="${ans.submitted ? "" : `clickOption(${idx}, '${opt.key}')`}">
        <input type="${inputType}" name="q${idx}" value="${opt.key}"
               ${inputChecked} ${lockedAttr} ${changeHandler}
               id="opt-${idx}-${opt.key}" />
        <span class="option-key">${opt.key}.</span>
        <div>
          <div class="option-text">${opt.text}</div>
          ${missedHTML}
        </div>
      </li>`;
    })
    .join("");

  // Feedback (shown after submission)
  let feedbackHTML = "";
  if (ans.submitted) {
    const distractors = Object.entries(q.explanation.distractors)
      .map(
        ([key, text]) => `
        <div class="distractor-item">
          <span class="distractor-key">${key}.</span>${text}
        </div>`,
      )
      .join("");

    const feedbackBody = `
      <div class="feedback-block" id="fb-body-${idx}"
           ${state.feedbackOpen[idx] ? "" : 'style="display:none"'}>
        <div class="feedback-correct">
          <strong>✓ Correct Answer:</strong> ${q.explanation.correct}
        </div>
        <div class="distractor-list">${distractors}</div>
      </div>`;

    // On revisited questions default collapsed; on fresh submit default open
    const freshSubmit = !state.feedbackOpen[idx] && ans.submitted;
    const btnLabel = state.feedbackOpen[idx]
      ? "Hide Feedback"
      : "Show Feedback";

    feedbackHTML = `
      <div class="feedback-toggle">
        <button class="btn btn-secondary btn-sm"
                onclick="toggleFeedback(${idx})" id="fb-btn-${idx}">
          ${btnLabel}
        </button>
      </div>
      ${feedbackBody}`;
  }

  // Submit / Next / Results button
  let actionBtn = "";
  if (!ans.submitted) {
    const canSubmit = ans.selected.length === req;
    actionBtn = `
      <button class="btn btn-primary" id="submit-btn"
              onclick="submitAnswer(${idx})" ${canSubmit ? "" : "disabled"}>
        Submit
      </button>`;
  } else if (isLast) {
    actionBtn = `
      <button class="btn btn-primary" onclick="renderReport()">
        View Results
      </button>`;
  } else {
    actionBtn = `
      <button class="btn btn-primary" onclick="goNext()">
        Next
      </button>`;
  }

  const prevBtn = `
    <button class="btn btn-secondary" onclick="goPrev()" ${
      idx === 0 ? "disabled" : ""
    }>
      Previous
    </button>`;

  $("view-exam").innerHTML = `
    ${header}
    <div class="question-card">
      ${scenario}
      <div class="question-stem">${q.stem}</div>
      ${instruction}
      <ul class="options-list">${optionsHTML}</ul>
      ${feedbackHTML}
    </div>
    <div class="exam-nav">
      ${prevBtn}
      ${actionBtn}
    </div>`;
}

function clickOption(idx, key) {
  // Clicking the label area — proxy to the input
  const input = document.getElementById(`opt-${idx}-${key}`);
  if (input) input.click();
}

function handleSelect(idx, key, inputEl) {
  const q = state.exam.questions[idx];
  const ans = state.answers[idx];
  const req = requiredCount(q);

  if (req > 1) {
    if (inputEl.checked) {
      if (!ans.selected.includes(key)) ans.selected.push(key);
    } else {
      ans.selected = ans.selected.filter((k) => k !== key);
    }
  } else {
    ans.selected = [key];
  }

  // Update submit button state
  const btn = document.getElementById("submit-btn");
  if (btn) btn.disabled = ans.selected.length !== req;
}

function submitAnswer(idx) {
  state.answers[idx].submitted = true;
  state.feedbackOpen[idx] = true; // open by default on fresh submit
  saveSession();
  renderQuestion(idx);
  // scroll to top of question card
  $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleFeedback(idx) {
  state.feedbackOpen[idx] = !state.feedbackOpen[idx];
  const body = document.getElementById(`fb-body-${idx}`);
  const btn = document.getElementById(`fb-btn-${idx}`);
  if (body) body.style.display = state.feedbackOpen[idx] ? "" : "none";
  if (btn)
    btn.textContent = state.feedbackOpen[idx]
      ? "Hide Feedback"
      : "Show Feedback";
}

function goNext() {
  if (state.current < state.exam.questions.length - 1) {
    state.current++;
    saveSession();
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function goPrev() {
  if (state.current > 0) {
    state.current--;
    saveSession();
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ─── Performance History ────────────────────────────────────────── */
async function saveHistory() {
  const questions = state.exam.questions;
  const total = questions.length;

  let score = 0;
  const perQuestionResults = questions.map((q, i) => {
    const isCorrect = countCorrect(q, state.answers[i].selected);
    if (isCorrect) score++;
    return {
      questionId: q.id,
      domain: q.domain,
      correct: isCorrect,
      userAnswer: state.answers[i].selected,
      correctAnswer: q.correct,
    };
  });

  const domainBreakdown = {};
  questions.forEach((q, i) => {
    if (!domainBreakdown[q.domain])
      domainBreakdown[q.domain] = { correct: 0, total: 0 };
    domainBreakdown[q.domain].total++;
    if (countCorrect(q, state.answers[i].selected))
      domainBreakdown[q.domain].correct++;
  });

  const record = {
    testPath: state.testMeta.path,
    testLabel: state.testMeta.label,
    topic: state.exam.topic,
    provider: state.navPath[0] ? state.navPath[0].id : null,
    score,
    total,
    percentage: Math.round((score / total) * 100),
    domainBreakdown,
    perQuestionResults,
    completedAt: Date.now(),
  };

  // Save to localStorage (capped at 100 entries)
  try {
    const raw = localStorage.getItem("cert_history");
    const history = raw ? JSON.parse(raw) : [];
    history.unshift(record);
    if (history.length > 100) history.length = 100;
    localStorage.setItem("cert_history", JSON.stringify(history));
  } catch (e) {
    /* ignore */
  }

  // Save to Firestore if authenticated
  if (state.user && window.firestoreAddDoc) {
    try {
      const colRef = window.firestoreCollection(
        window.firebaseDb,
        "users",
        state.user.uid,
        "history",
      );
      await window.firestoreAddDoc(colRef, record);
    } catch (e) {
      /* network error — localStorage has it */
    }
  }
}

async function loadHistory() {
  // If authenticated, load from Firestore
  if (state.user && window.firestoreGetDocs) {
    try {
      const colRef = window.firestoreCollection(
        window.firebaseDb,
        "users",
        state.user.uid,
        "history",
      );
      const q = window.firestoreQuery(
        colRef,
        window.firestoreOrderBy("completedAt", "desc"),
      );
      const snap = await window.firestoreGetDocs(q);
      const results = [];
      snap.forEach((doc) => results.push(doc.data()));
      return results;
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem("cert_history");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/* ─── HISTORY VIEW ──────────────────────────────────────────────── */
async function renderHistory() {
  showView("history");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    { label: "History" },
  ]);

  const el = $("view-history");
  el.innerHTML = `
    <h1 class="page-title">Performance History</h1>
    <div class="state-msg">Loading...</div>`;

  const history = await loadHistory();

  if (history.length === 0) {
    el.innerHTML = `
      <h1 class="page-title">Performance History</h1>
      <p class="page-subtitle">No completed tests yet</p>
      <p class="state-msg">Complete a test to see your performance history here.</p>`;
    return;
  }

  // Aggregate stats
  const totalTests = history.length;
  const avgScore = Math.round(
    history.reduce((sum, h) => sum + h.percentage, 0) / totalTests,
  );

  // Find weakest domains across all attempts
  const domainAgg = {};
  history.forEach((h) => {
    if (h.domainBreakdown) {
      Object.entries(h.domainBreakdown).forEach(([domain, data]) => {
        if (!domainAgg[domain]) domainAgg[domain] = { correct: 0, total: 0 };
        domainAgg[domain].correct += data.correct;
        domainAgg[domain].total += data.total;
      });
    }
  });
  const weakDomains = Object.entries(domainAgg)
    .map(([d, v]) => ({
      domain: d,
      pct: Math.round((v.correct / v.total) * 100),
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  // Build history list
  const historyItems = history
    .map((h, idx) => {
      const date = new Date(h.completedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const time = new Date(h.completedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const pctClass =
        h.percentage >= 80
          ? "score-high"
          : h.percentage >= 60
            ? "score-mid"
            : "score-low";

      const domainBars = h.domainBreakdown
        ? Object.entries(h.domainBreakdown)
            .map(([d, v]) => {
              const dpct = Math.round((v.correct / v.total) * 100);
              return `<div class="history-domain-row">
              <span class="history-domain-name">${d}</span>
              <div class="history-bar-track">
                <div class="history-bar-fill ${
                  dpct >= 80 ? "bar-high" : dpct >= 60 ? "bar-mid" : "bar-low"
                }" style="width:${dpct}%"></div>
              </div>
              <span class="history-domain-score">${v.correct}/${v.total}</span>
            </div>`;
            })
            .join("")
        : "";

      return `
      <div class="history-item">
        <div class="history-item-header" onclick="toggleHistoryDetail(${idx})">
          <div class="history-item-info">
            <span class="history-item-label">${h.testLabel || h.topic}</span>
            <span class="history-item-date">${date} ${time}</span>
          </div>
          <div class="history-item-score ${pctClass}">${h.percentage}%
            <span class="history-item-raw">(${h.score}/${h.total})</span>
          </div>
        </div>
        <div class="history-item-detail hidden" id="history-detail-${idx}">
          ${domainBars}
        </div>
      </div>`;
    })
    .join("");

  // Weak domains section
  const weakDomainsHTML =
    weakDomains.length > 0
      ? `<div class="section-heading">Areas to Improve</div>
       <div class="weak-domains">
         ${weakDomains
           .map(
             (d) =>
               `<div class="weak-domain-item"><span>${
                 d.domain
               }</span><span class="${
                 d.pct >= 80
                   ? "score-high"
                   : d.pct >= 60
                     ? "score-mid"
                     : "score-low"
               }">${d.pct}%</span></div>`,
           )
           .join("")}
       </div>`
      : "";

  el.innerHTML = `
    <h1 class="page-title">Performance History</h1>
    <div class="history-stats">
      <div class="stat-card">
        <div class="stat-value">${totalTests}</div>
        <div class="stat-label">Tests Taken</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgScore}%</div>
        <div class="stat-label">Average Score</div>
      </div>
    </div>
    ${weakDomainsHTML}
    <div class="section-heading">All Attempts</div>
    <div class="history-list">${historyItems}</div>`;
}

function toggleHistoryDetail(idx) {
  const detail = document.getElementById(`history-detail-${idx}`);
  if (detail) detail.classList.toggle("hidden");
}

/* ─── REPORT VIEW ───────────────────────────────────────────────── */
function renderReport() {
  clearSession(); // Test complete — no need to resume
  saveHistory(); // Persist results for performance tracking
  showView("report");
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
  });
  crumbs.push({
    label: state.testMeta.label,
    action: `navigateToDepth(${state.navPath.length - 1})`,
  });
  crumbs.push({ label: "Results" });
  setBreadcrumb(crumbs);

  const questions = state.exam.questions;
  const total = questions.length;

  // Score
  let score = 0;
  questions.forEach((q, i) => {
    if (countCorrect(q, state.answers[i].selected)) score++;
  });
  const pct = Math.round((score / total) * 100);

  // Domain analysis
  const domainMap = {}; // { domain: { correct, total } }
  questions.forEach((q, i) => {
    if (!domainMap[q.domain]) domainMap[q.domain] = { correct: 0, total: 0 };
    domainMap[q.domain].total++;
    if (countCorrect(q, state.answers[i].selected))
      domainMap[q.domain].correct++;
  });

  const domainRows = Object.entries(domainMap)
    .map(([d, v]) => {
      const missed = v.correct < v.total;
      return `<tr class="domain-row ${missed ? "missed" : ""}">
      <td>${d}</td>
      <td>${v.correct} / ${v.total}</td>
    </tr>`;
    })
    .join("");

  // Question review
  const reviewItems = questions
    .map((q, i) => {
      const ans = state.answers[i];
      const isCorrect = countCorrect(q, ans.selected);
      const userKeys = ans.selected.join(", ") || "—";
      const correctKeys = q.correct.join(", ");

      const scenarioHTML = q.scenario
        ? `<div class="scenario-block" style="margin-bottom:10px">${q.scenario}</div>`
        : "";

      const optionReviews = q.options
        .map((opt) => {
          const isUserSel = ans.selected.includes(opt.key);
          const isAnsCorrect = q.correct.includes(opt.key);
          let cls = "";
          if (isAnsCorrect) cls = "opt-correct";
          else if (isUserSel && !isAnsCorrect) cls = "opt-wrong";
          const explanation = isAnsCorrect
            ? q.explanation.correct
            : q.explanation.distractors[opt.key] || "";
          return `<div class="review-option ${cls}">
        <strong>${opt.key}. ${opt.text}</strong>
        ${
          explanation
            ? `<div style="margin-top:4px;color:var(--text-muted)">${explanation}</div>`
            : ""
        }
      </div>`;
        })
        .join("");

      return `
      <div class="review-item ${isCorrect ? "correct" : "incorrect"}">
        <div class="review-meta">
          <span class="review-number">Q${i + 1}</span>
          <span class="domain-badge">${q.domain}</span>
          <span class="status-pill ${isCorrect ? "correct" : "incorrect"}">
            ${isCorrect ? "Correct" : "Incorrect"}
          </span>
        </div>
        ${scenarioHTML}
        <div class="review-stem">${q.stem}</div>
        <div class="review-answers">
          Your answer: <span>${userKeys}</span> &nbsp;|&nbsp;
          Correct: <span>${correctKeys}</span>
        </div>
        <div class="review-explanation">${q.explanation.correct}</div>
        <div class="review-options">${optionReviews}</div>
      </div>`;
    })
    .join("");

  $("view-report").innerHTML = `
    <div class="report-header">
      <div class="page-title">${state.exam.topic}</div>
      <div class="score-display">${score} / ${total}</div>
      <div class="score-pct">${pct}%</div>
    </div>

    <div class="section-heading">Domain Analysis</div>
    <table class="domain-table">
      <thead><tr><th>Domain</th><th>Score</th></tr></thead>
      <tbody>${domainRows}</tbody>
    </table>

    <div class="section-heading">Question Review</div>
    ${reviewItems}

    <div class="report-actions">
      <button class="btn btn-secondary" onclick="retakeTest()">Retake Test</button>
      <button class="btn btn-primary"   onclick="downloadPDF()">Download Report</button>
    </div>`;
}

function retakeTest() {
  clearSession();
  const n = state.exam.questions.length;
  state.answers = Array.from({ length: n }, () => ({
    selected: [],
    submitted: false,
  }));
  state.feedbackOpen = new Array(n).fill(false);
  state.current = 0;
  renderExam();
}

/* ─── PDF EXPORT ────────────────────────────────────────────────── */
function downloadPDF() {
  const reportEl = $("view-report");
  const filename = `${state.exam.topic.replace(/\s+/g, "_")}_report.pdf`;

  // Temporarily hide the action buttons so they don't appear in the PDF
  const actions = reportEl.querySelector(".report-actions");
  if (actions) actions.style.display = "none";

  const opt = {
    margin: [10, 10, 10, 10],
    filename: filename,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };

  html2pdf()
    .set(opt)
    .from(reportEl)
    .save()
    .then(() => {
      if (actions) actions.style.display = "";
    })
    .catch(() => {
      if (actions) actions.style.display = "";
    });
}

/* ─── Boot ──────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", renderHome);
