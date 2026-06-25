/* ─── State ─────────────────────────────────────────────────────── */
const state = {
  manifest: null,
  provider: null, // { id, label, topics }
  topic: null, // { id, label, tests }
  testMeta: null, // { id, label, path }
  exam: null, // loaded JSON { topic, questions }
  answers: [], // [{ selected: [...keys], submitted: bool }]
  current: 0,
  feedbackOpen: [], // [bool]
};

/* ─── Helpers ───────────────────────────────────────────────────── */
function $(id) {
  return document.getElementById(id);
}

function showView(name) {
  ["home", "topic", "tests", "exam", "report"].forEach((v) => {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  });
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
    <div class="card-grid">
      ${providers
        .map(
          (p) => `
        <div class="card" onclick="selectProvider('${p.id}')">
          <div class="card-title">${p.label}</div>
          <div class="card-meta">${p.topics.length} topic${
            p.topics.length !== 1 ? "s" : ""
          }</div>
        </div>`,
        )
        .join("")}
    </div>`;
}

function selectProvider(id) {
  state.provider = state.manifest.providers.find((p) => p.id === id);
  renderTopic();
}

/* ─── TOPIC VIEW ────────────────────────────────────────────────── */
function renderTopic() {
  showView("topic");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    { label: state.provider.label },
  ]);

  const topics = state.provider.topics;
  $("view-topic").innerHTML = `
    <h1 class="page-title">${state.provider.label}</h1>
    <p class="page-subtitle">Select a topic</p>
    <div class="card-grid">
      ${topics
        .map(
          (t) => `
        <div class="card" onclick="selectTopic('${t.id}')">
          <div class="card-title">${t.label}</div>
          <div class="card-meta">${t.tests.length} test${
            t.tests.length !== 1 ? "s" : ""
          }</div>
        </div>`,
        )
        .join("")}
    </div>`;
}

function selectTopic(id) {
  state.topic = state.provider.topics.find((t) => t.id === id);
  renderTestList();
}

/* ─── TEST LIST VIEW ────────────────────────────────────────────── */
function renderTestList() {
  showView("tests");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    {
      label: state.provider.label,
      action: `selectProvider('${state.provider.id}')`,
    },
    { label: state.topic.label },
  ]);

  const rows = state.topic.tests
    .map(
      (t) => `
    <div class="test-row" id="row-${t.id}">
      <span class="test-row-label">${t.label}</span>
      <button class="btn btn-primary btn-sm" onclick="startTest('${t.id}')">Start</button>
    </div>`,
    )
    .join("");

  $("view-tests").innerHTML = `
    <h1 class="page-title">${state.topic.label}</h1>
    <p class="page-subtitle">Choose a test to begin</p>
    <div class="test-list">${rows}</div>`;
}

async function startTest(id) {
  state.testMeta = state.topic.tests.find((t) => t.id === id);
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

  // Init exam state
  const n = state.exam.questions.length;
  state.answers = Array.from({ length: n }, () => ({
    selected: [],
    submitted: false,
  }));
  state.feedbackOpen = new Array(n).fill(false);
  state.current = 0;
  renderExam();
}

/* ─── EXAM VIEW ─────────────────────────────────────────────────── */
function renderExam() {
  showView("exam");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    {
      label: state.provider.label,
      action: `selectProvider('${state.provider.id}')`,
    },
    { label: state.topic.label, action: `selectTopic('${state.topic.id}')` },
    { label: state.testMeta.label, action: `renderTestList()` },
    { label: `Q${state.current + 1}` },
  ]);
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
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function goPrev() {
  if (state.current > 0) {
    state.current--;
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ─── REPORT VIEW ───────────────────────────────────────────────── */
function renderReport() {
  showView("report");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    {
      label: state.provider.label,
      action: `selectProvider('${state.provider.id}')`,
    },
    { label: state.topic.label, action: `selectTopic('${state.topic.id}')` },
    { label: state.testMeta.label, action: `renderTestList()` },
    { label: "Results" },
  ]);

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
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 15;
  const usable = pw - margin * 2;
  let y = margin;

  function checkPage(needed = 8) {
    if (y + needed > ph - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function text(str, x, size = 10, style = "normal", color = [30, 30, 30]) {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str), usable - (x - margin));
    checkPage(lines.length * (size * 0.4));
    doc.text(lines, x, y);
    y += lines.length * (size * 0.45) + 2;
  }

  function heading(str, size = 13) {
    checkPage(12);
    y += 3;
    doc.setFontSize(size);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(37, 99, 235);
    doc.text(str, margin, y);
    y += size * 0.5 + 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 4;
  }

  const questions = state.exam.questions;
  const total = questions.length;
  let score = 0;
  questions.forEach((q, i) => {
    if (countCorrect(q, state.answers[i].selected)) score++;
  });
  const pct = Math.round((score / total) * 100);

  // ── Summary
  heading(`${state.exam.topic} — Results`, 14);
  text(`Score: ${score} / ${total}  (${pct}%)`, margin, 12, "bold");
  y += 4;

  // ── Domain Analysis
  heading("Domain Analysis");
  const domainMap = {};
  questions.forEach((q, i) => {
    if (!domainMap[q.domain]) domainMap[q.domain] = { correct: 0, total: 0 };
    domainMap[q.domain].total++;
    if (countCorrect(q, state.answers[i].selected))
      domainMap[q.domain].correct++;
  });
  Object.entries(domainMap).forEach(([d, v]) => {
    const missed = v.correct < v.total;
    text(
      `${d}: ${v.correct} / ${v.total}${missed ? "  ✗" : "  ✓"}`,
      margin,
      10,
      "normal",
      missed ? [180, 83, 9] : [22, 163, 74],
    );
  });
  y += 4;

  // ── Question Review
  heading("Question Review");
  questions.forEach((q, i) => {
    const ans = state.answers[i];
    const isCorrect = countCorrect(q, ans.selected);
    checkPage(20);

    text(
      `Q${i + 1} [${q.domain}]  —  ${isCorrect ? "CORRECT" : "INCORRECT"}`,
      margin,
      10,
      "bold",
      isCorrect ? [22, 163, 74] : [220, 38, 38],
    );

    if (q.scenario) {
      text(`Scenario: ${q.scenario}`, margin + 4, 9, "italic", [107, 114, 128]);
    }

    text(q.stem, margin + 4, 10);

    q.options.forEach((opt) => {
      const isUserSel = ans.selected.includes(opt.key);
      const isAnsCorrect = q.correct.includes(opt.key);
      let color = [80, 80, 80];
      let style = "normal";
      if (isAnsCorrect) {
        color = [22, 163, 74];
        style = "bold";
      } else if (isUserSel) {
        color = [220, 38, 38];
      }
      text(`${opt.key}. ${opt.text}`, margin + 8, 9, style, color);

      const expl = isAnsCorrect
        ? q.explanation.correct
        : q.explanation.distractors[opt.key] || "";
      if (expl) text(`→ ${expl}`, margin + 12, 8, "normal", [107, 114, 128]);
    });

    text(
      `Your answer: ${
        ans.selected.join(", ") || "—"
      }   Correct: ${q.correct.join(", ")}`,
      margin + 4,
      9,
      "normal",
      [80, 80, 80],
    );
    y += 4;
  });

  doc.save(`${state.exam.topic.replace(/\s+/g, "_")}_report.pdf`);
}

/* ─── Boot ──────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", renderHome);
