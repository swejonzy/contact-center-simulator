/**
 * UI Controller for Contact Center Capacity Simulator
 * Binds sliders, numeric inputs, and synthetic presets to the Erlang C engine.
 */

const PRESETS = {
  small: {
    callsPerHour: 120,
    ahtSeconds: 300,
    agents: 15,
    targetSlPercent: 80,
    targetTimeSeconds: 20
  },
  standard: {
    callsPerHour: 600,
    ahtSeconds: 300,
    agents: 57,
    targetSlPercent: 80,
    targetTimeSeconds: 20
  },
  enterprise: {
    callsPerHour: 2100,
    ahtSeconds: 300,
    agents: 185,
    targetSlPercent: 80,
    targetTimeSeconds: 20
  },
  overload: {
    callsPerHour: 720,
    ahtSeconds: 320,
    agents: 60, // Workload is 64.0 Erlangs -> Unstable queue edge case
    targetSlPercent: 80,
    targetTimeSeconds: 20
  }
};

const AVAILABLE_SKILLS = [
  { id: 'sales', label: 'Sales' },
  { id: 'billing', label: 'Billing' },
  { id: 'tech', label: 'Tech Support' },
  { id: 'vip', label: 'VIP / Retention' }
];

const DEFAULT_MULTI_QUEUES = [
  { id: 'q-sales', name: 'Sales & Orders', requiredSkill: 'sales', callsPerHour: 240, ahtSeconds: 210 },
  { id: 'q-billing', name: 'Billing & Account', requiredSkill: 'billing', callsPerHour: 270, ahtSeconds: 240 },
  { id: 'q-tech', name: 'Technical Support', requiredSkill: 'tech', callsPerHour: 120, ahtSeconds: 450 }
];

const DEFAULT_AGENT_GROUPS = [
  { id: 'g-sales', name: 'Sales Specialists', agents: 14, skills: ['sales'] },
  { id: 'g-billing', name: 'Billing Specialists', agents: 17, skills: ['billing'] },
  { id: 'g-tech', name: 'Tech Tier-1 Team', agents: 15, skills: ['tech'] },
  { id: 'g-flex', name: 'Cross-Trained Flex Pool', agents: 10, skills: ['sales', 'billing', 'tech'] }
];

let multiQueues = JSON.parse(JSON.stringify(DEFAULT_MULTI_QUEUES));
let agentGroups = JSON.parse(JSON.stringify(DEFAULT_AGENT_GROUPS));

document.addEventListener('DOMContentLoaded', () => {
  // Input & Slider pairs
  const controls = [
    { slider: 'inflowSlider', input: 'inflowInput', key: 'callsPerHour' },
    { slider: 'ahtSlider', input: 'ahtInput', key: 'ahtSeconds' },
    { slider: 'agentsSlider', input: 'agentsInput', key: 'agents' },
    { slider: 'targetSlSlider', input: 'targetSlInput', key: 'targetSlPercent' },
    { slider: 'targetTimeSlider', input: 'targetTimeInput', key: 'targetTimeSeconds' },
    { slider: 'botContainmentSlider', input: 'botContainmentInput', key: 'botContainmentPercent' }
  ];

  // Bind bidirectional sync between range sliders and number inputs
  controls.forEach(({ slider, input }) => {
    const sliderEl = document.getElementById(slider);
    const inputEl = document.getElementById(input);

    sliderEl.addEventListener('input', () => {
      inputEl.value = sliderEl.value;
      if (slider === 'agentsSlider') {
        document.getElementById('heroAgentsSlider').value = sliderEl.value;
      }
      clearActivePreset();
      updateSimulation();
    });

    inputEl.addEventListener('input', () => {
      if (inputEl.value !== '') {
        sliderEl.value = Math.min(Number(sliderEl.max), Math.max(Number(sliderEl.min), Number(inputEl.value)));
        if (input === 'agentsInput') {
          const heroSlider = document.getElementById('heroAgentsSlider');
          heroSlider.value = Math.min(200, Math.max(1, Number(inputEl.value)));
        }
      }
      clearActivePreset();
      updateSimulation();
    });
  });

  // Iteration 2: Bind Interactive 1–100 Hero Agent Slider & +/- Step Buttons
  const heroSliderEl = document.getElementById('heroAgentsSlider');
  const stepDownBtn = document.getElementById('agentStepDown');
  const stepUpBtn = document.getElementById('agentStepUp');

  heroSliderEl.addEventListener('input', () => {
    setControlValue('agentsSlider', 'agentsInput', heroSliderEl.value);
    clearActivePreset();
    updateSimulation();
  });

  stepDownBtn.addEventListener('click', () => {
    const current = parseInt(document.getElementById('agentsInput').value, 10) || 1;
    const next = Math.max(1, current - 1);
    setControlValue('agentsSlider', 'agentsInput', next);
    clearActivePreset();
    updateSimulation();
  });

  stepUpBtn.addEventListener('click', () => {
    const current = parseInt(document.getElementById('agentsInput').value, 10) || 1;
    const next = Math.min(200, current + 1);
    setControlValue('agentsSlider', 'agentsInput', next);
    clearActivePreset();
    updateSimulation();
  });

  // Bind Preset Buttons
  const presetButtons = document.querySelectorAll('.btn-preset');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const presetKey = btn.getAttribute('data-preset');
      const preset = PRESETS[presetKey];
      if (!preset) return;

      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      setControlValue('inflowSlider', 'inflowInput', preset.callsPerHour);
      setControlValue('ahtSlider', 'ahtInput', preset.ahtSeconds);
      setControlValue('agentsSlider', 'agentsInput', preset.agents);
      setControlValue('targetSlSlider', 'targetSlInput', preset.targetSlPercent);
      setControlValue('targetTimeSlider', 'targetTimeInput', preset.targetTimeSeconds);

      updateSimulation();
    });
  });

  // Bind "Apply Recommended" button
  const applyRecBtn = document.getElementById('applyRecBtn');
  applyRecBtn.addEventListener('click', () => {
    const recAgents = Number(applyRecBtn.getAttribute('data-rec-agents'));
    if (recAgents > 0) {
      setControlValue('agentsSlider', 'agentsInput', recAgents);
      clearActivePreset();
      updateSimulation();
    }
  });

  // Iteration 3 & 4: Bind Multi-Queue & Skill-Based Routing Controls
  const addQueueBtn = document.getElementById('addQueueBtn');
  const addAgentGroupBtn = document.getElementById('addAgentGroupBtn');
  const resetQueuesBtn = document.getElementById('resetQueuesBtn');
  const syncBlendedToMainBtn = document.getElementById('syncBlendedToMainBtn');

  addQueueBtn.addEventListener('click', () => {
    const nextIdx = multiQueues.length + 1;
    multiQueues.push({
      id: `q-custom-${Date.now()}`,
      name: `VIP Queue ${nextIdx}`,
      requiredSkill: 'vip',
      callsPerHour: 90,
      ahtSeconds: 300
    });
    renderMultiQueueSection(getFormParams());
  });

  addAgentGroupBtn.addEventListener('click', () => {
    const nextIdx = agentGroups.length + 1;
    agentGroups.push({
      id: `g-custom-${Date.now()}`,
      name: `Flex Team ${nextIdx}`,
      agents: 8,
      skills: ['sales', 'vip']
    });
    renderMultiQueueSection(getFormParams());
  });

  resetQueuesBtn.addEventListener('click', () => {
    multiQueues = JSON.parse(JSON.stringify(DEFAULT_MULTI_QUEUES));
    agentGroups = JSON.parse(JSON.stringify(DEFAULT_AGENT_GROUPS));
    renderMultiQueueSection(getFormParams());
  });

  syncBlendedToMainBtn.addEventListener('click', () => {
    const params = getFormParams();
    const sbrEval = evaluateSkillBasedRouting(
      multiQueues,
      agentGroups,
      params.targetSlPercent,
      params.targetTimeSeconds
    );
    if (sbrEval.summary.totalCalls > 0) {
      const weightedAht = (sbrEval.summary.totalErlangs * 3600) / sbrEval.summary.totalCalls;
      setControlValue('inflowSlider', 'inflowInput', Math.round(sbrEval.summary.totalCalls));
      setControlValue('ahtSlider', 'ahtInput', Math.round(weightedAht));
      setControlValue('agentsSlider', 'agentsInput', Math.max(1, sbrEval.summary.totalAgents));
      clearActivePreset();
      updateSimulation();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Iteration 5: Bind AI Voicebot Quick Preset Buttons
  const botPresetBtns = document.querySelectorAll('.btn-bot-rate');
  botPresetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = Number(btn.getAttribute('data-bot-rate')) || 0;
      botPresetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setControlValue('botContainmentSlider', 'botContainmentInput', rate);
      updateSimulation();
    });
  });

  // Initial calculation on load
  updateSimulation();
});

function setControlValue(sliderId, inputId, value) {
  const sliderEl = document.getElementById(sliderId);
  const inputEl = document.getElementById(inputId);
  inputEl.value = value;
  sliderEl.value = Math.min(Number(sliderEl.max), Math.max(Number(sliderEl.min), Number(value)));
  if (inputId === 'agentsInput') {
    const heroSlider = document.getElementById('heroAgentsSlider');
    if (heroSlider) {
      heroSlider.value = Math.min(200, Math.max(1, Number(value)));
    }
  }
}

function clearActivePreset() {
  document.querySelectorAll('.btn-preset').forEach((b) => b.classList.remove('active'));
}

function getFormParams() {
  const grossCallsPerHour = parseFloat(document.getElementById('inflowInput').value) || 0;
  const botContainmentPercent = Math.min(
    99,
    Math.max(0, parseFloat(document.getElementById('botContainmentInput').value) || 0)
  );
  const ahtSeconds = parseFloat(document.getElementById('ahtInput').value) || 0;
  const botFlow = calculateVoicebotDeflection(grossCallsPerHour, botContainmentPercent, ahtSeconds);

  return {
    grossCallsPerHour,
    botContainmentPercent,
    deflectedCallsPerHour: botFlow.deflectedCallsPerHour,
    callsPerHour: botFlow.netCallsPerHour, // Net calls reaching human agents
    grossErlangs: botFlow.grossErlangs,
    erlangsSavedByBot: botFlow.erlangsSaved,
    ahtSeconds,
    agents: parseInt(document.getElementById('agentsInput').value, 10) || 0,
    targetSlPercent: parseFloat(document.getElementById('targetSlInput').value) || 80,
    targetTimeSeconds: parseFloat(document.getElementById('targetTimeInput').value) || 20
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '∞';
  if (seconds < 60) return `${seconds.toFixed(1)}`;
  const mins = seconds / 60;
  return `${seconds.toFixed(0)} (${mins.toFixed(1)}m)`;
}

function updateSimulation() {
  const params = getFormParams();

  // Update AHT minutes helper label
  const ahtMin = (params.ahtSeconds / 60).toFixed(1);
  document.getElementById('ahtMinutesHint').textContent = `${params.ahtSeconds}s (${ahtMin} min)`;

  // Run Erlang C evaluation on Net Human Calls (after AI Voicebot containment)
  const result = evaluateContactCenter(params);

  // Also evaluate what human staffing would have been required WITHOUT the AI Voicebot (0% containment)
  const noBotEval = evaluateContactCenter({
    ...params,
    callsPerHour: params.grossCallsPerHour
  });
  const humanAgentsSavedByBot = Math.max(
    0,
    noBotEval.requiredAgentsForTarget - result.requiredAgentsForTarget
  );

  // Update AI Voicebot Pipeline Card
  document.getElementById('botRateTag').textContent = `${params.botContainmentPercent}% Resolved by AI`;
  document.getElementById('pipeBotPct').textContent = `${params.botContainmentPercent}%`;
  document.getElementById('pipeGrossCalls').textContent = `${Math.round(params.grossCallsPerHour)} calls/hr`;
  document.getElementById('pipeGrossErlangs').textContent = `${params.grossErlangs.toFixed(2)} Erlangs total demand (needs ${noBotEval.requiredAgentsForTarget} agents without AI)`;
  document.getElementById('pipeDeflectedCalls').textContent = `${Math.round(params.deflectedCallsPerHour)} calls/hr`;
  document.getElementById('pipeErlangsSaved').textContent = `${params.erlangsSavedByBot.toFixed(2)} Erlangs offloaded from humans`;
  document.getElementById('pipeNetCalls').textContent = `${Math.round(params.callsPerHour)} calls/hr`;
  document.getElementById('pipeNetErlangs').innerHTML = `${result.erlangs.toFixed(2)} Erlangs → Min <strong>${result.requiredAgentsForTarget}</strong> human agents for SLA`;

  const savingsBadge = document.getElementById('botAgentSavingsBadge');
  savingsBadge.textContent =
    humanAgentsSavedByBot > 0
      ? `${humanAgentsSavedByBot} Human Agent${humanAgentsSavedByBot === 1 ? '' : 's'} Saved by AI Voicebot (${noBotEval.requiredAgentsForTarget} → ${result.requiredAgentsForTarget})`
      : '0 Human Agents Saved (AI at 0%)';

  // Sync active state on Quick AI Preset buttons
  document.querySelectorAll('.btn-bot-rate').forEach((btn) => {
    const presetRate = Number(btn.getAttribute('data-bot-rate'));
    btn.classList.toggle('active', presetRate === params.botContainmentPercent);
  });

  // 1. Update Verdict Banner
  const banner = document.getElementById('verdictBanner');
  banner.className = `verdict-banner status-${result.verdict.status}`;
  document.getElementById('verdictStatusText').textContent = result.verdict.label;
  document.getElementById('verdictHeadline').textContent = result.verdict.headline;
  document.getElementById('verdictDetail').textContent = result.verdict.detail;

  const recValueEl = document.getElementById('recAgentsValue');
  const applyRecBtn = document.getElementById('applyRecBtn');
  recValueEl.textContent = result.isZeroWorkload ? '0' : `${result.requiredAgentsForTarget}`;
  applyRecBtn.setAttribute('data-rec-agents', result.requiredAgentsForTarget);
  applyRecBtn.disabled = result.isZeroWorkload || params.agents === result.requiredAgentsForTarget;
  applyRecBtn.textContent =
    params.agents === result.requiredAgentsForTarget ? 'At Recommended' : 'Apply Recommended';

  // 1b. Update Iteration 2 Hero Agent Slider Card & Threshold Markers (1 to 200 scale)
  document.getElementById('heroAgentCount').textContent = params.agents;
  const heroSliderEl = document.getElementById('heroAgentsSlider');
  heroSliderEl.value = Math.min(200, Math.max(1, params.agents));

  const heroDeltaTag = document.getElementById('heroDeltaTag');
  if (result.isZeroWorkload) {
    heroDeltaTag.textContent = 'Queue Idle (0 Erlangs)';
    heroDeltaTag.style.background = '#ecfdf5';
    heroDeltaTag.style.color = '#065f46';
  } else if (result.agentDelta > 0) {
    heroDeltaTag.textContent = `+${result.agentDelta} vs. SLA Target (${result.requiredAgentsForTarget})`;
    heroDeltaTag.style.background = '#ecfdf5';
    heroDeltaTag.style.color = '#065f46';
  } else if (result.agentDelta === 0) {
    heroDeltaTag.textContent = `Exact SLA Target (${result.requiredAgentsForTarget} Agents)`;
    heroDeltaTag.style.background = '#eff6ff';
    heroDeltaTag.style.color = '#1e40af';
  } else {
    heroDeltaTag.textContent = `${result.agentDelta} vs. SLA Target (Need ${result.requiredAgentsForTarget})`;
    heroDeltaTag.style.background = '#fef2f2';
    heroDeltaTag.style.color = '#991b1b';
  }

  // Position markers on 1–200 slider track
  const markerWorkload = document.getElementById('markerWorkload');
  const markerSla = document.getElementById('markerSla');
  const minStableAgents = Math.floor(result.erlangs) + 1;

  if (!result.isZeroWorkload && minStableAgents >= 1 && minStableAgents <= 200) {
    const pct = ((minStableAgents - 1) / 199) * 100;
    markerWorkload.style.display = 'flex';
    markerWorkload.style.left = `${pct}%`;
    document.getElementById('markerWorkloadText').textContent = `Min Stable (${minStableAgents})`;
  } else {
    markerWorkload.style.display = 'none';
  }

  if (!result.isZeroWorkload && result.requiredAgentsForTarget >= 1 && result.requiredAgentsForTarget <= 200) {
    const pct = ((result.requiredAgentsForTarget - 1) / 199) * 100;
    markerSla.style.display = 'flex';
    markerSla.style.left = `${pct}%`;
    document.getElementById('markerSlaText').textContent = `SLA Target (${result.requiredAgentsForTarget})`;
  } else {
    markerSla.style.display = 'none';
  }

  // 2. Update Workload KPI
  document.getElementById('kpiWorkload').textContent = result.erlangs.toFixed(2);
  const minStable = result.isZeroWorkload ? 0 : Math.floor(result.erlangs) + 1;
  document.getElementById('kpiWorkloadSub').textContent = result.isZeroWorkload
    ? 'No traffic offered to the queue'
    : `Minimum ${minStable} agents required for queue stability`;

  // 3. Update Service Level KPI
  document.getElementById('slTargetBadge').textContent =
    `Target: ${params.targetSlPercent}% in ${params.targetTimeSeconds}s`;
  document.getElementById('kpiServiceLevel').textContent = `${result.serviceLevelPercent.toFixed(1)}%`;
  document.getElementById('kpiProbWait').textContent = `${result.probabilityOfWaitingPercent.toFixed(1)}%`;

  const slMeter = document.getElementById('slMeterFill');
  slMeter.style.width = `${Math.min(100, Math.max(0, result.serviceLevelPercent))}%`;
  slMeter.style.backgroundColor = getStatusColor(result.verdict.status);

  // 4. Update Occupancy KPI
  document.getElementById('kpiOccupancy').textContent = `${result.occupancyPercent.toFixed(1)}%`;
  const occMeter = document.getElementById('occMeterFill');
  occMeter.style.width = `${Math.min(100, Math.max(0, result.occupancyPercent))}%`;
  occMeter.style.backgroundColor =
    !result.isStable || result.occupancyPercent >= 95
      ? '#ef4444'
      : result.occupancyPercent > 85
      ? '#f59e0b'
      : '#2563eb';

  const occSub = document.getElementById('kpiOccupancySub');
  if (!result.isStable) {
    occSub.textContent = `Overloaded: Offered workload is ${result.rawOccupancyPercent.toFixed(1)}% of capacity (capped at 100%)`;
  } else if (result.occupancyPercent > 88) {
    occSub.textContent = 'High utilization (>88%) — limited recovery time between calls';
  } else {
    occSub.textContent = 'Productive time while logged in (capped at 100%)';
  }

  // 5. Update ASA KPI
  const asaValueEl = document.getElementById('kpiAsa');
  const asaUnitEl = document.getElementById('kpiAsaUnit');
  const asaSubEl = document.getElementById('kpiAsaSub');

  if (!result.isStable) {
    asaValueEl.textContent = '∞';
    asaUnitEl.textContent = 'Unstable Queue';
    asaSubEl.textContent = 'Wait time grows indefinitely when Agents ≤ Workload';
  } else {
    asaValueEl.textContent = formatDuration(result.asaSeconds);
    asaUnitEl.textContent = 'sec';
    asaSubEl.textContent = `Threshold is ${params.targetTimeSeconds}s • ${result.probabilityOfWaitingPercent.toFixed(1)}% of callers wait`;
  }

  // 6. Render Service Level Curve Graph (Agents on X-axis vs. Expected SL on Y-axis)
  renderServiceLevelChart(params, result);

  // 7. Populate Sensitivity Table
  renderSensitivityTable(params, result);

  // 8. Render Multi-Queue Section (uses shared SLA Target % and Target Time threshold)
  renderMultiQueueSection(params);
}

function getStatusColor(status) {
  if (status === 'green') return '#10b981';
  if (status === 'yellow') return '#f59e0b';
  return '#ef4444';
}

function renderServiceLevelChart(params, currentResult) {
  const svg = document.getElementById('slChartSvg');
  if (!svg) return;

  const width = 720;
  const height = 290;
  const pad = { top: 24, right: 30, bottom: 44, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Determine a meaningful X-axis range [minN, maxN] around workload, SLA target, and current agents
  let minN = 1;
  let maxN = 100;

  if (!currentResult.isZeroWorkload) {
    const minStable = Math.floor(currentResult.erlangs) + 1;
    const req = currentResult.requiredAgentsForTarget;
    const lowAnchor = Math.min(params.agents, minStable);
    const highAnchor = Math.max(params.agents, req);

    // Show from ~15% below workload up to ~20% above SLA target (or full 1..100 if small/medium)
    minN = Math.max(1, Math.floor(lowAnchor - Math.max(8, currentResult.erlangs * 0.25)));
    maxN = Math.max(minN + 20, Math.ceil(highAnchor + Math.max(12, currentResult.erlangs * 0.25)));
  }

  const xForN = (n) => pad.left + ((n - minN) / Math.max(1, maxN - minN)) * plotW;
  const yForSl = (sl) => pad.top + (1 - Math.min(100, Math.max(0, sl)) / 100) * plotH;

  // Compute data points for every integer agent count in [minN, maxN]
  const points = [];
  for (let n = minN; n <= maxN; n++) {
    let sl = 100;
    if (!currentResult.isZeroWorkload) {
      if (n <= currentResult.erlangs) {
        sl = 0;
      } else {
        const pw = calculateProbabilityOfWaiting(currentResult.erlangs, n);
        const slFrac = 1 - pw * Math.exp(-(n - currentResult.erlangs) * (params.targetTimeSeconds / params.ahtSeconds));
        sl = Math.min(100, Math.max(0, slFrac * 100));
      }
    }
    points.push({ n, sl, x: xForN(n), y: yForSl(sl) });
  }

  // Build SVG path for line and area fill
  const linePath = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');
  const baselineY = yForSl(0);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;

  // Horizontal Y-axis grid lines (0%, 20%, 40%, 60%, 80%, 100%)
  const yTicks = [0, 20, 40, 60, 80, 100];
  const yGridHtml = yTicks
    .map((tick) => {
      const y = yForSl(tick).toFixed(1);
      return `
        <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
        <text x="${pad.left - 10}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="#64748b" font-weight="600">${tick}%</text>
      `;
    })
    .join('');

  // Vertical X-axis ticks (~6 evenly spaced integer ticks)
  const xTickCount = 6;
  const xTicks = [];
  for (let i = 0; i <= xTickCount; i++) {
    const nVal = Math.round(minN + (i / xTickCount) * (maxN - minN));
    if (!xTicks.includes(nVal)) xTicks.push(nVal);
  }
  const xGridHtml = xTicks
    .map((nVal) => {
      const x = xForN(nVal).toFixed(1);
      return `
        <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
        <text x="${x}" y="${pad.top + plotH + 18}" text-anchor="middle" font-size="11" fill="#64748b" font-weight="600">${nVal}</text>
      `;
    })
    .join('');

  // Target SLA Horizontal Dashed Line
  const targetY = yForSl(params.targetSlPercent).toFixed(1);
  const targetLineHtml = `
    <line x1="${pad.left}" y1="${targetY}" x2="${width - pad.right}" y2="${targetY}"
          stroke="#10b981" stroke-width="2" stroke-dasharray="6,4" />
    <rect x="${width - pad.right - 108}" y="${Number(targetY) - 18}" width="104" height="16" rx="4" fill="#ecfdf5" />
    <text x="${width - pad.right - 56}" y="${Number(targetY) - 7}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#047857">
      Target: ${params.targetSlPercent}% SL
    </text>
  `;

  // Unstable Zone Shading (where N <= Erlangs)
  let unstableZoneHtml = '';
  if (!currentResult.isZeroWorkload && currentResult.erlangs >= minN) {
    const unstableRightX = Math.min(width - pad.right, xForN(Math.floor(currentResult.erlangs)));
    const zoneWidth = Math.max(0, unstableRightX - pad.left);
    if (zoneWidth > 0) {
      unstableZoneHtml = `
        <rect x="${pad.left}" y="${pad.top}" width="${zoneWidth.toFixed(1)}" height="${plotH}"
              fill="rgba(239, 68, 68, 0.07)" />
        <line x1="${unstableRightX.toFixed(1)}" y1="${pad.top}" x2="${unstableRightX.toFixed(1)}" y2="${pad.top + plotH}"
              stroke="#fca5a5" stroke-width="1.5" stroke-dasharray="3,3" />
      `;
    }
  }

  // Current Selected Agent Point & Callout
  const curX = xForN(params.agents);
  const curY = yForSl(currentResult.serviceLevelPercent);
  const statusColor = getStatusColor(currentResult.verdict.status);
  const labelAbove = curY > pad.top + 34;
  const badgeY = labelAbove ? curY - 30 : curY + 12;
  const badgeX = Math.min(width - pad.right - 68, Math.max(pad.left + 4, curX - 64));

  const currentMarkerHtml = `
    <line x1="${curX.toFixed(1)}" y1="${pad.top}" x2="${curX.toFixed(1)}" y2="${pad.top + plotH}"
          stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,4" />
    <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="7" fill="${statusColor}" stroke="#ffffff" stroke-width="2.5" />
    <rect x="${badgeX.toFixed(1)}" y="${badgeY.toFixed(1)}" width="128" height="22" rx="6"
          fill="#0f172a" opacity="0.92" />
    <text x="${(badgeX + 64).toFixed(1)}" y="${(badgeY + 14.5).toFixed(1)}" text-anchor="middle"
          font-size="11" font-weight="700" fill="#ffffff">
      N = ${params.agents} → ${currentResult.serviceLevelPercent.toFixed(1)}%
    </text>
  `;

  // Interactive clickable dots along the curve so the user can click any agent count on the graph
  const interactiveDotsHtml = points
    .map(
      (pt) => `
      <circle class="chart-point-hit" data-agent="${pt.n}"
              cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="6"
              fill="transparent">
        <title>${pt.n} Agents → Expected SL: ${pt.sl.toFixed(1)}%</title>
      </circle>
    `
    )
    .join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="slAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2563eb" stop-opacity="0.24" />
        <stop offset="100%" stop-color="#2563eb" stop-opacity="0.02" />
      </linearGradient>
    </defs>

    <!-- Grid & Axes -->
    ${yGridHtml}
    ${xGridHtml}
    ${unstableZoneHtml}

    <!-- Axis Titles -->
    <text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="#334155">
      Scheduled / Available Agents (N) — Click any point on the curve to set staffing
    </text>
    <text x="15" y="${pad.top + plotH / 2}" text-anchor="middle" font-size="12" font-weight="700" fill="#334155"
          transform="rotate(-90 15 ${pad.top + plotH / 2})">
      Expected Service Level (%)
    </text>

    <!-- Target SLA Line -->
    ${targetLineHtml}

    <!-- SL Curve Area & Line -->
    <path d="${areaPath}" fill="url(#slAreaGrad)" />
    <path d="${linePath}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Current Agent Marker -->
    ${currentMarkerHtml}

    <!-- Interactive Hover/Click Targets -->
    ${interactiveDotsHtml}
  `;

  // Allow clicking any point on the chart to jump to that agent count
  svg.querySelectorAll('.chart-point-hit').forEach((circle) => {
    circle.addEventListener('click', () => {
      const clickedN = parseInt(circle.getAttribute('data-agent'), 10);
      if (clickedN > 0) {
        setControlValue('agentsSlider', 'agentsInput', clickedN);
        clearActivePreset();
        updateSimulation();
      }
    });
  });
}

function renderSensitivityTable(params, currentResult) {
  const tbody = document.getElementById('sensitivityTableBody');
  tbody.innerHTML = '';

  const centerAgents = Math.max(3, params.agents);
  const offsets = [-3, -2, -1, 0, 1, 2, 3];

  offsets.forEach((offset) => {
    const n = centerAgents + offset;
    if (n < 1) return;

    const rowEval = evaluateContactCenter({ ...params, agents: n });
    const tr = document.createElement('tr');
    if (n === params.agents) {
      tr.className = 'current-row';
    }

    const diffLabel =
      n === params.agents
        ? 'Current'
        : n - params.agents > 0
        ? `+${n - params.agents}`
        : `${n - params.agents}`;

    const asaText = rowEval.isStable ? `${rowEval.asaSeconds.toFixed(1)}s` : '∞ (Unstable)';
    const pillClass = `pill-status pill-${rowEval.verdict.status}`;
    const pillText =
      rowEval.verdict.status === 'green'
        ? 'Meets SLA'
        : rowEval.verdict.status === 'yellow'
        ? 'Borderline'
        : rowEval.isStable
        ? 'Below SLA'
        : 'Overloaded';

    tr.innerHTML = `
      <td><strong>${n}</strong> agents</td>
      <td>${diffLabel}</td>
      <td>${rowEval.occupancyPercent.toFixed(1)}%</td>
      <td>${rowEval.probabilityOfWaitingPercent.toFixed(1)}%</td>
      <td>${asaText}</td>
      <td><strong>${rowEval.serviceLevelPercent.toFixed(1)}%</strong></td>
      <td><span class="${pillClass}">${pillText}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function getSkillLabel(skillId) {
  const found = AVAILABLE_SKILLS.find((s) => s.id === skillId);
  return found ? found.label : skillId;
}

function renderMultiQueueSection(params) {
  const qTbody = document.getElementById('multiQueueTableBody');
  const gTbody = document.getElementById('agentGroupsTableBody');
  if (!qTbody || !gTbody) return;

  // Evaluate Skill-Based Routing (SBR) with AI Voicebot front-door containment applied
  const sbrEval = evaluateSkillBasedRouting(
    multiQueues,
    agentGroups,
    params.targetSlPercent,
    params.targetTimeSeconds,
    params.botContainmentPercent
  );

  // Also compute 100% Universal Pool benchmark for the 3-way comparison banner
  const weightedAht =
    sbrEval.summary.totalCalls > 0
      ? (sbrEval.summary.totalErlangs * 3600) / sbrEval.summary.totalCalls
      : 0;
  const universalEval = evaluateContactCenter({
    callsPerHour: sbrEval.summary.totalCalls,
    ahtSeconds: weightedAht,
    agents: Math.max(1, sbrEval.summary.totalAgents),
    targetSlPercent: params.targetSlPercent,
    targetTimeSeconds: params.targetTimeSeconds
  });

  // 1. Update 3-Way Comparison Banner
  document.getElementById('sbrSiloMinAgents').textContent = `${sbrEval.summary.sumQueueMinAgents} agents`;
  document.getElementById('mqTotalErlangs').textContent = `${sbrEval.summary.totalErlangs.toFixed(2)} E`;

  document.getElementById('sbrTotalAgents').textContent = `${sbrEval.summary.totalAgents}`;
  document.getElementById('sbrCenterSl').textContent = `${sbrEval.summary.serviceLevelPercent.toFixed(1)}%`;
  document.getElementById('sbrCenterAsa').textContent = sbrEval.summary.isStable
    ? `${sbrEval.summary.asaSeconds.toFixed(1)}s`
    : '∞ (Unstable)';
  document.getElementById('sbrCenterOcc').textContent = `${sbrEval.summary.occupancyPercent.toFixed(1)}%`;

  const sbrBadge = document.getElementById('sbrCenterBadge');
  sbrBadge.className = `pill-status pill-${sbrEval.summary.status}`;
  sbrBadge.textContent =
    sbrEval.summary.status === 'green'
      ? 'SBR Meets SLA'
      : sbrEval.summary.status === 'yellow'
      ? 'Borderline'
      : 'SBR Below SLA';

  document.getElementById('mqBlendedReq').textContent = `${universalEval.requiredAgentsForTarget} agents`;
  document.getElementById('mqBlendedSl').textContent = `${universalEval.serviceLevelPercent.toFixed(1)}%`;
  const blendedBadge = document.getElementById('mqBlendedBadge');
  blendedBadge.className = `pill-status pill-${universalEval.verdict.status}`;
  blendedBadge.textContent =
    universalEval.verdict.status === 'green' ? 'Pool Meets SLA' : 'Pool Below SLA';

  // 2. Render Step 1: Agent Groups & Skill Toggle Matrix
  gTbody.innerHTML = '';
  sbrEval.agentGroups.forEach((g, gIdx) => {
    const tr = document.createElement('tr');

    const skillPillsHtml = AVAILABLE_SKILLS.map((sk) => {
      const hasSkill = g.skills.includes(sk.id);
      return `<button type="button" class="skill-toggle-btn ${hasSkill ? 'active' : ''}"
                      data-group-idx="${gIdx}" data-skill="${sk.id}">
                ${hasSkill ? '✓ ' : '+ '}${sk.label}
              </button>`;
    }).join('');

    const routingSplitHtml =
      g.queueShares.length > 0
        ? g.queueShares
            .map(
              (qs) =>
                `<span class="routing-chip">${qs.queueName}: <strong>${qs.allocatedAgents.toFixed(1)}</strong> ag (${qs.sharePercent.toFixed(0)}%)</span>`
            )
            .join('')
        : `<span class="pill-status pill-yellow">Idle — No matching queue for assigned skills</span>`;

    tr.innerHTML = `
      <td>
        <input type="text" class="mq-input-name" data-g-idx="${gIdx}" data-g-field="name" value="${g.name}" aria-label="Agent Group Name" />
      </td>
      <td>
        <input type="number" class="mq-input-num" data-g-idx="${gIdx}" data-g-field="agents" min="0" max="500" step="1" value="${g.agents}" aria-label="Agents in ${g.name}" />
      </td>
      <td style="text-align: left;">
        <div class="skill-pills-wrap">${skillPillsHtml}</div>
      </td>
      <td style="text-align: left;">
        <div class="routing-split-list">${routingSplitHtml}</div>
      </td>
      <td><strong>${g.occupancyPercent.toFixed(1)}%</strong></td>
      <td>
        ${
          agentGroups.length > 1
            ? `<button type="button" class="btn-remove-queue" data-remove-group="${gIdx}" title="Remove Agent Group">×</button>`
            : ''
        }
      </td>
    `;
    gTbody.appendChild(tr);
  });

  // Bind Agent Group inputs & skill pill toggles
  gTbody.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      const gIdx = parseInt(input.getAttribute('data-g-idx'), 10);
      const field = input.getAttribute('data-g-field');
      if (!agentGroups[gIdx]) return;
      if (field === 'name') {
        agentGroups[gIdx].name = input.value.trim() || `Team ${gIdx + 1}`;
      } else {
        agentGroups[gIdx].agents = Math.max(0, parseInt(input.value, 10) || 0);
      }
      renderMultiQueueSection(getFormParams());
    });
  });

  gTbody.querySelectorAll('.skill-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gIdx = parseInt(btn.getAttribute('data-group-idx'), 10);
      const skillId = btn.getAttribute('data-skill');
      const group = agentGroups[gIdx];
      if (!group) return;

      if (group.skills.includes(skillId)) {
        // Keep at least 1 skill active so the group isn't accidentally emptied
        if (group.skills.length > 1) {
          group.skills = group.skills.filter((s) => s !== skillId);
        }
      } else {
        group.skills.push(skillId);
      }
      renderMultiQueueSection(getFormParams());
    });
  });

  gTbody.querySelectorAll('[data-remove-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gIdx = parseInt(btn.getAttribute('data-remove-group'), 10);
      if (agentGroups.length > 1) {
        agentGroups.splice(gIdx, 1);
        renderMultiQueueSection(getFormParams());
      }
    });
  });

  // 3. Render Step 2: Queues & Required Skill Table
  qTbody.innerHTML = '';
  sbrEval.queues.forEach((q, qIdx) => {
    const tr = document.createElement('tr');
    const asaText = q.isStable ? `${q.asaSeconds.toFixed(1)}s` : '∞ (Unstable)';
    const pillClass = `pill-status pill-${q.verdict.status}`;

    const skillOptionsHtml = AVAILABLE_SKILLS.map(
      (sk) =>
        `<option value="${sk.id}" ${q.requiredSkill === sk.id ? 'selected' : ''}>${sk.label}</option>`
    ).join('');

    tr.innerHTML = `
      <td>
        <input type="text" class="mq-input-name" data-q-idx="${qIdx}" data-q-field="name" value="${q.name}" aria-label="Queue Name" />
      </td>
      <td style="text-align: left;">
        <select class="skill-select" data-q-idx="${qIdx}" data-q-field="requiredSkill" aria-label="Required skill for ${q.name}">
          ${skillOptionsHtml}
        </select>
      </td>
      <td>
        <input type="number" class="mq-input-num" data-q-idx="${qIdx}" data-q-field="callsPerHour" min="0" max="10000" step="10" value="${q.grossCallsPerHour}" />
      </td>
      <td>
        <strong>${Math.round(q.callsPerHour)}</strong>/hr
        <span class="pool-subtext">(-${Math.round(q.aiDeflectedCalls)} AI)</span>
      </td>
      <td>
        <input type="number" class="mq-input-num" data-q-idx="${qIdx}" data-q-field="ahtSeconds" min="1" max="7200" step="10" value="${q.ahtSeconds}" />
      </td>
      <td><strong>${q.erlangs.toFixed(2)} E</strong></td>
      <td>
        <strong>${q.effectiveAgents.toFixed(1)}</strong> eff.
        <span class="pool-subtext">(${q.totalQualifiedAgents} qualified in pool)</span>
      </td>
      <td>${q.requiredAgentsForTarget}</td>
      <td>${q.occupancyPercent.toFixed(1)}%</td>
      <td>${asaText}</td>
      <td><strong>${q.serviceLevelPercent.toFixed(1)}%</strong></td>
      <td><span class="${pillClass}">${q.verdict.label}</span></td>
      <td>
        ${
          multiQueues.length > 1
            ? `<button type="button" class="btn-remove-queue" data-remove-queue="${qIdx}" title="Remove Queue">×</button>`
            : ''
        }
      </td>
    `;
    qTbody.appendChild(tr);
  });

  // Bind Queue row inputs & selects
  qTbody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', () => {
      const qIdx = parseInt(el.getAttribute('data-q-idx'), 10);
      const field = el.getAttribute('data-q-field');
      if (!multiQueues[qIdx]) return;

      if (field === 'name') {
        multiQueues[qIdx].name = el.value.trim() || `Queue ${qIdx + 1}`;
      } else if (field === 'requiredSkill') {
        multiQueues[qIdx].requiredSkill = el.value;
      } else {
        multiQueues[qIdx][field] = Math.max(0, parseFloat(el.value) || 0);
      }
      renderMultiQueueSection(getFormParams());
    });
  });

  qTbody.querySelectorAll('[data-remove-queue]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qIdx = parseInt(btn.getAttribute('data-remove-queue'), 10);
      if (multiQueues.length > 1) {
        multiQueues.splice(qIdx, 1);
        renderMultiQueueSection(getFormParams());
      }
    });
  });

  // 4. Update Table Footer Totals
  document.getElementById('mqFootGrossCalls').innerHTML = `<strong>${Math.round(sbrEval.summary.totalGrossCalls)}</strong> gross/hr`;
  document.getElementById('mqFootCalls').innerHTML = `<strong>${Math.round(sbrEval.summary.totalCalls)}</strong> net/hr (-${Math.round(sbrEval.summary.totalAiDeflectedCalls)} AI)`;
  document.getElementById('mqFootAht').innerHTML = `<strong>${weightedAht.toFixed(1)}s</strong> (weighted)`;
  document.getElementById('mqFootErlangs').innerHTML = `<strong>${sbrEval.summary.totalErlangs.toFixed(2)} E</strong>`;
  document.getElementById('mqFootAgents').innerHTML = `<strong>${sbrEval.summary.totalAgents}</strong> total agents`;
  document.getElementById('mqFootReq').innerHTML = `<strong>${sbrEval.summary.sumQueueMinAgents}</strong> (Silo) / <strong>${universalEval.requiredAgentsForTarget}</strong> (Pool)`;
  document.getElementById('mqFootOcc').innerHTML = `<strong>${sbrEval.summary.occupancyPercent.toFixed(1)}%</strong>`;
  document.getElementById('mqFootAsa').innerHTML = `<strong>${
    sbrEval.summary.isStable ? sbrEval.summary.asaSeconds.toFixed(1) + 's' : '∞'
  }</strong>`;
  document.getElementById('mqFootSl').innerHTML = `<strong>${sbrEval.summary.serviceLevelPercent.toFixed(1)}%</strong> (SBR)`;
}
