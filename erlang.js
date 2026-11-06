/**
 * Erlang C Calculation Engine for Contact Center Capacity Modeling
 * 
 * Uses an iterative Erlang B recurrence relation to compute Erlang C (Probability of Waiting)
 * with complete numerical stability (no factorial or exponent overflow even for thousands of agents).
 */

/**
 * Calculates Traffic Intensity (Workload) in Erlangs.
 * @param {number} callsPerHour - Incoming contacts per hour
 * @param {number} ahtSeconds - Average Handling Time in seconds
 * @returns {number} Workload in Erlangs (A)
 */
function calculateWorkloadErlangs(callsPerHour, ahtSeconds) {
  if (callsPerHour <= 0 || ahtSeconds <= 0) return 0;
  return (callsPerHour * ahtSeconds) / 3600;
}

/**
 * Calculates AI Voicebot front-door deflection (containment) before calls reach human agents.
 *
 * @param {number} grossCallsPerHour - Total incoming calls arriving at the AI Voicebot
 * @param {number} containmentPercent - % of calls resolved autonomously by the AI Voicebot (0 to 100)
 * @param {number} ahtSeconds - Human Average Handling Time in seconds
 * @returns {Object} Deflected calls, Net calls reaching humans, and Erlangs saved
 */
function calculateVoicebotDeflection(grossCallsPerHour, containmentPercent, ahtSeconds = 300) {
  const grossCalls = Math.max(0, Number(grossCallsPerHour) || 0);
  const rate = Math.min(100, Math.max(0, Number(containmentPercent) || 0)) / 100;
  const deflectedCallsPerHour = grossCalls * rate;
  const netCallsPerHour = grossCalls * (1 - rate);
  const grossErlangs = calculateWorkloadErlangs(grossCalls, ahtSeconds);
  const netErlangs = calculateWorkloadErlangs(netCallsPerHour, ahtSeconds);
  const erlangsSaved = Math.max(0, grossErlangs - netErlangs);

  return {
    grossCallsPerHour: grossCalls,
    containmentPercent: rate * 100,
    deflectedCallsPerHour,
    netCallsPerHour,
    grossErlangs,
    netErlangs,
    erlangsSaved
  };
}

/**
 * Calculates the Erlang C Probability of Waiting (Pw) using numerically stable
 * iterative Erlang B recurrence.
 * 
 * @param {number} erlangs - Traffic intensity (A) in Erlangs
 * @param {number} agents - Number of available agents (N)
 * @returns {number} Probability that an arriving call has to wait (0 to 1)
 */
function calculateProbabilityOfWaiting(erlangs, agents) {
  if (erlangs <= 0) return 0;
  if (agents <= erlangs) return 1; // Unstable queue: 100% wait probability in steady state

  // Step 1: Compute Erlang B iteratively: E_B(k, A) = (A * E_B(k-1, A)) / (k + A * E_B(k-1, A))
  let erlangB = 1.0;
  for (let k = 1; k <= agents; k++) {
    erlangB = (erlangs * erlangB) / (k + erlangs * erlangB);
  }

  // Step 2: Convert Erlang B to Erlang C (Probability of Waiting, Pw)
  const rho = erlangs / agents; // Raw utilization
  const pw = erlangB / (1 - rho * (1 - erlangB));

  return Math.min(1, Math.max(0, pw));
}

/**
 * Evaluates full Contact Center performance metrics for a given staffing level.
 * 
 * @param {Object} params
 * @param {number} params.callsPerHour - Inflow (calls per hour)
 * @param {number} params.ahtSeconds - Average Handling Time in seconds
 * @param {number} params.agents - Number of scheduled/available agents
 * @param {number} params.targetSlPercent - Target Service Level percentage (e.g., 80)
 * @param {number} params.targetTimeSeconds - Target answer threshold in seconds (e.g., 20)
 * @returns {Object} Calculated KPIs and staffing verdict
 */
function evaluateContactCenter(params) {
  const callsPerHour = Math.max(0, Number(params.callsPerHour) || 0);
  const ahtSeconds = Math.max(0, Number(params.ahtSeconds) || 0);
  const agents = Math.max(0, Math.floor(Number(params.agents) || 0));
  const targetSlPercent = Math.min(100, Math.max(0, Number(params.targetSlPercent) || 80));
  const targetTimeSeconds = Math.max(0, Number(params.targetTimeSeconds) || 20);

  const erlangs = calculateWorkloadErlangs(callsPerHour, ahtSeconds);

  // Edge Case 1: Zero workload (0 calls or 0 AHT)
  if (erlangs === 0) {
    return {
      erlangs: 0,
      occupancyPercent: 0,
      rawOccupancyPercent: 0,
      probabilityOfWaitingPercent: 0,
      serviceLevelPercent: 100,
      asaSeconds: 0,
      isStable: true,
      isZeroWorkload: true,
      requiredAgentsForTarget: 0,
      agentDelta: agents,
      verdict: {
        status: 'green',
        label: 'Meet Target (Idle)',
        headline: 'No incoming workload — queue is idle',
        detail: 'Workload is 0.00 Erlangs. Any staffing level meets the Service Level target.'
      }
    };
  }

  const rawOccupancyPercent = agents > 0 ? (erlangs / agents) * 100 : Infinity;
  const occupancyPercent = Math.min(100, rawOccupancyPercent);
  const isStable = agents > erlangs;

  // Find minimum agents required to achieve Target SL
  const requiredAgentsForTarget = findRequiredAgents(
    erlangs,
    ahtSeconds,
    targetSlPercent,
    targetTimeSeconds
  );
  const agentDelta = agents - requiredAgentsForTarget;

  // Edge Case 2: Understaffed / Unstable Queue (Agents <= Workload in Erlangs)
  if (!isStable) {
    const minStableAgents = Math.floor(erlangs) + 1;
    return {
      erlangs,
      occupancyPercent: 100,
      rawOccupancyPercent,
      probabilityOfWaitingPercent: 100,
      serviceLevelPercent: 0,
      asaSeconds: Infinity,
      isStable: false,
      isZeroWorkload: false,
      requiredAgentsForTarget,
      agentDelta,
      verdict: {
        status: 'red',
        label: 'Critical SLA Failure — Unstable Queue',
        headline: `Offered workload (${erlangs.toFixed(2)} E) exceeds or equals available agents (${agents})`,
        detail: `Queue grows infinitely because arrivals outpace capacity. You need at least ${minStableAgents} agents just to stabilize the queue, and ${requiredAgentsForTarget} agents (+${requiredAgentsForTarget - agents}) to hit your ${targetSlPercent}% in ${targetTimeSeconds}s SLA.`
      }
    };
  }

  // Standard Stable Case (Agents > Erlangs)
  const pw = calculateProbabilityOfWaiting(erlangs, agents);
  const asaSeconds = (pw * ahtSeconds) / (agents - erlangs);
  const slFraction = 1 - pw * Math.exp(-(agents - erlangs) * (targetTimeSeconds / ahtSeconds));
  const serviceLevelPercent = Math.min(100, Math.max(0, slFraction * 100));

  // Determine Verdict (Green / Yellow / Red)
  const slGap = serviceLevelPercent - targetSlPercent;
  let verdict;

  if (slGap >= 0) {
    const highOccupancyNote = occupancyPercent > 85
      ? ` Note: Agent occupancy is high (${occupancyPercent.toFixed(1)}%), which may risk fatigue if sustained.`
      : '';
    const surplusNote = agentDelta > 0
      ? ` You have a buffer of +${agentDelta} agent${agentDelta === 1 ? '' : 's'} above the minimum (${requiredAgentsForTarget}) needed for SLA.`
      : ` You are at the exact minimum staffing (${requiredAgentsForTarget} agents) required for SLA.`;

    verdict = {
      status: 'green',
      label: 'SLA Target Met',
      headline: `Service Level of ${serviceLevelPercent.toFixed(1)}% meets the ${targetSlPercent}% target`,
      detail: `Estimated ASA is ${asaSeconds.toFixed(1)}s with ${occupancyPercent.toFixed(1)}% occupancy.${surplusNote}${highOccupancyNote}`
    };
  } else if (slGap >= -5) {
    const needed = Math.max(1, requiredAgentsForTarget - agents);
    verdict = {
      status: 'yellow',
      label: 'Near SLA Target (Borderline)',
      headline: `Service Level of ${serviceLevelPercent.toFixed(1)}% is within 5 pts of the ${targetSlPercent}% target`,
      detail: `Queue is stable, but slightly under-resourced. Adding ${needed} more agent${needed === 1 ? '' : 's'} (to ${requiredAgentsForTarget} total) will bring Service Level onto target.`
    };
  } else {
    const needed = Math.max(1, requiredAgentsForTarget - agents);
    verdict = {
      status: 'red',
      label: 'SLA Target Missed',
      headline: `Service Level of ${serviceLevelPercent.toFixed(1)}% falls short of the ${targetSlPercent}% target`,
      detail: `Estimated wait time (ASA) is ${asaSeconds.toFixed(1)}s. You need ${requiredAgentsForTarget} agents (+${needed} more) to achieve ${targetSlPercent}% answered within ${targetTimeSeconds}s.`
    };
  }

  return {
    erlangs,
    occupancyPercent,
    rawOccupancyPercent,
    probabilityOfWaitingPercent: pw * 100,
    serviceLevelPercent,
    asaSeconds,
    isStable: true,
    isZeroWorkload: false,
    requiredAgentsForTarget,
    agentDelta,
    verdict
  };
}

/**
 * Finds the minimum number of agents needed to meet or exceed the Target Service Level.
 */
function findRequiredAgents(erlangs, ahtSeconds, targetSlPercent, targetTimeSeconds) {
  if (erlangs <= 0) return 0;
  const targetFraction = targetSlPercent / 100;
  let n = Math.floor(erlangs) + 1;
  const maxSearch = Math.max(2000, Math.ceil(erlangs * 5) + 500);

  while (n < maxSearch) {
    const pw = calculateProbabilityOfWaiting(erlangs, n);
    const sl = 1 - pw * Math.exp(-(n - erlangs) * (targetTimeSeconds / ahtSeconds));
    if (sl + 1e-9 >= targetFraction) {
      return n;
    }
    n++;
  }
  return n;
}

/**
 * Evaluates a Multi-Queue Contact Center comparing:
 * 1. Siloed Mode: Each queue operates independently with its own dedicated agents.
 * 2. Blended / Pooled Mode: All incoming volume is combined into a single shared agent pool
 *    using volume-weighted Average Handling Time (AHT).
 *
 * @param {Array<Object>} queues - List of queue configs: [{ id, name, callsPerHour, ahtSeconds, agents }]
 * @param {number} targetSlPercent - Target Service Level percentage (e.g., 80)
 * @param {number} targetTimeSeconds - Target answer time threshold in seconds (e.g., 20)
 * @param {string} mode - 'siloed' or 'blended'
 * @returns {Object} Per-queue evaluations, Siloed summary, Blended summary, and Pooling Synergy metrics
 */
function evaluateMultiQueueCenter(queues, targetSlPercent, targetTimeSeconds, mode = 'siloed') {
  const validQueues = (queues || []).map((q, idx) => ({
    id: q.id || `q-${idx + 1}`,
    name: q.name || `Queue ${idx + 1}`,
    callsPerHour: Math.max(0, Number(q.callsPerHour) || 0),
    ahtSeconds: Math.max(1, Number(q.ahtSeconds) || 180),
    agents: Math.max(1, Math.floor(Number(q.agents) || 1))
  }));

  let totalCallsPerHour = 0;
  let totalWorkloadSeconds = 0;
  let totalSiloedAgents = 0;
  let totalSiloedRequiredAgents = 0;
  let weightedSiloedSlSum = 0;
  let weightedSiloedAsaSum = 0;
  let anySiloUnstable = false;

  const queueResults = validQueues.map((q) => {
    const evalResult = evaluateContactCenter({
      callsPerHour: q.callsPerHour,
      ahtSeconds: q.ahtSeconds,
      agents: q.agents,
      targetSlPercent,
      targetTimeSeconds
    });

    totalCallsPerHour += q.callsPerHour;
    totalWorkloadSeconds += q.callsPerHour * q.ahtSeconds;
    totalSiloedAgents += q.agents;
    totalSiloedRequiredAgents += evalResult.requiredAgentsForTarget;
    weightedSiloedSlSum += evalResult.serviceLevelPercent * q.callsPerHour;

    if (!evalResult.isStable && q.callsPerHour > 0) {
      anySiloUnstable = true;
    } else {
      weightedSiloedAsaSum += evalResult.asaSeconds * q.callsPerHour;
    }

    return {
      ...q,
      evaluation: evalResult
    };
  });

  // Volume-weighted AHT across all queues
  const weightedAhtSeconds =
    totalCallsPerHour > 0 ? totalWorkloadSeconds / totalCallsPerHour : 0;

  // Evaluate Blended (Shared Pool) using total calls, weighted AHT, and total agents
  const blendedEvaluation = evaluateContactCenter({
    callsPerHour: totalCallsPerHour,
    ahtSeconds: weightedAhtSeconds,
    agents: totalSiloedAgents,
    targetSlPercent,
    targetTimeSeconds
  });

  // Siloed Aggregate KPIs (volume-weighted across individual queues)
  const totalErlangs = totalWorkloadSeconds / 3600;
  const siloedWeightedSl =
    totalCallsPerHour > 0 ? weightedSiloedSlSum / totalCallsPerHour : 100;
  const siloedWeightedAsa =
    totalCallsPerHour === 0 ? 0 : anySiloUnstable ? Infinity : weightedSiloedAsaSum / totalCallsPerHour;
  const siloedOccupancy =
    totalErlangs === 0 ? 0 : Math.min(100, (totalErlangs / Math.max(1, totalSiloedAgents)) * 100);

  // Pooling Synergy: How many fewer agents are required when blending vs. separate silos
  const agentsSavedByBlending = Math.max(
    0,
    totalSiloedRequiredAgents - blendedEvaluation.requiredAgentsForTarget
  );

  return {
    mode,
    queues: queueResults,
    totals: {
      callsPerHour: totalCallsPerHour,
      weightedAhtSeconds,
      erlangs: totalErlangs,
      agents: totalSiloedAgents
    },
    siloedSummary: {
      serviceLevelPercent: siloedWeightedSl,
      asaSeconds: siloedWeightedAsa,
      occupancyPercent: siloedOccupancy,
      isStable: !anySiloUnstable,
      requiredAgentsForTarget: totalSiloedRequiredAgents
    },
    blendedSummary: blendedEvaluation,
    synergy: {
      siloedRequiredAgents: totalSiloedRequiredAgents,
      blendedRequiredAgents: blendedEvaluation.requiredAgentsForTarget,
      agentsSaved: agentsSavedByBlending,
      slGainFromBlending: blendedEvaluation.serviceLevelPercent - siloedWeightedSl
    }
  };
}

/**
 * Evaluates Skill-Based Routing (SBR) across multiple queues and multi-skilled agent groups.
 *
 * How the SBR Capacity Allocation & Pooling Algorithm Works:
 * 1. Each Queue `q` requires a specific skill (`q.requiredSkill`) and has Workload `A_q` Erlangs.
 * 2. Each Agent Group `g` has a headcount (`g.agents`) and a set of skills (`g.skills` array).
 * 3. Specialists vs. Multi-Skilled Generalists Allocation (Iterative Proportional Balancing):
 *    - An agent group can only serve queues whose `requiredSkill` is in `g.skills`.
 *    - We iteratively balance agent allocation (`alloc[g][q]`) so that specialist groups
 *      cover their primary queues first, while multi-skilled groups naturally flow their capacity
 *      to equalize Occupancy across the queues they are qualified to handle.
 * 4. Effective Pooling Bonus (Cross-Skilled Sharing):
 *    - When a multi-skilled group covers multiple queues, those queues benefit from partial
 *      Erlang C pooling synergy (bounded between their Effective Dedicated Allocation and the
 *      Connected Skill Pool). We compute the effective Erlang C performance for each queue and
 *      also report per-Agent-Group Occupancy.
 *
 * @param {Array<Object>} queues - [{ id, name, requiredSkill, callsPerHour, ahtSeconds }]
 * @param {Array<Object>} agentGroups - [{ id, name, agents, skills: ['sales', 'billing'] }]
 * @param {number} targetSlPercent - Target Service Level %
 * @param {number} targetTimeSeconds - Target answer time threshold (sec)
 * @returns {Object} Detailed Queue results, Agent Group utilization, and Center-wide SBR KPIs
 */
function evaluateSkillBasedRouting(queues, agentGroups, targetSlPercent, targetTimeSeconds, aiContainmentPercent = 0) {
  const botRate = Math.min(100, Math.max(0, Number(aiContainmentPercent) || 0)) / 100;
  const validQueues = (queues || []).map((q, idx) => {
    const grossCallsPerHour = Math.max(0, Number(q.callsPerHour) || 0);
    const aiDeflectedCalls = grossCallsPerHour * botRate;
    const callsPerHour = grossCallsPerHour * (1 - botRate); // Net calls reaching human queue
    const ahtSeconds = Math.max(1, Number(q.ahtSeconds) || 180);
    const erlangs = calculateWorkloadErlangs(callsPerHour, ahtSeconds);
    return {
      id: q.id || `q-${idx + 1}`,
      name: q.name || `Queue ${idx + 1}`,
      requiredSkill: q.requiredSkill || 'general',
      grossCallsPerHour,
      aiDeflectedCalls,
      callsPerHour,
      ahtSeconds,
      erlangs
    };
  });

  const validGroups = (agentGroups || []).map((g, idx) => ({
    id: g.id || `g-${idx + 1}`,
    name: g.name || `Agent Group ${idx + 1}`,
    agents: Math.max(0, Math.floor(Number(g.agents) || 0)),
    skills: Array.isArray(g.skills) ? g.skills : []
  }));

  const numQ = validQueues.length;
  const numG = validGroups.length;

  // Eligibility matrix: can group g handle queue q?
  const canServe = validGroups.map((g) =>
    validQueues.map((q) => g.skills.includes(q.requiredSkill))
  );

  // Initialize allocation matrix alloc[g][q] proportionally to queue workloads
  const alloc = Array.from({ length: numG }, () => new Array(numQ).fill(0));

  for (let g = 0; g < numG; g++) {
    const groupAgents = validGroups[g].agents;
    if (groupAgents <= 0) continue;

    let eligibleErlangs = 0;
    let eligibleCount = 0;
    for (let q = 0; q < numQ; q++) {
      if (canServe[g][q]) {
        eligibleErlangs += validQueues[q].erlangs;
        eligibleCount++;
      }
    }

    if (eligibleCount > 0) {
      for (let q = 0; q < numQ; q++) {
        if (canServe[g][q]) {
          alloc[g][q] =
            eligibleErlangs > 0
              ? groupAgents * (validQueues[q].erlangs / eligibleErlangs)
              : groupAgents / eligibleCount;
        }
      }
    }
  }

  // Iterative load-balancing (15 passes): multi-skilled groups shift capacity toward higher-occupancy queues
  for (let iter = 0; iter < 15; iter++) {
    const effAgentsPerQ = new Array(numQ).fill(0);
    for (let q = 0; q < numQ; q++) {
      for (let g = 0; g < numG; g++) {
        effAgentsPerQ[q] += alloc[g][q];
      }
    }

    for (let g = 0; g < numG; g++) {
      const groupAgents = validGroups[g].agents;
      if (groupAgents <= 0) continue;

      const weights = new Array(numQ).fill(0);
      let weightSum = 0;

      for (let q = 0; q < numQ; q++) {
        if (!canServe[g][q]) continue;
        const qErlangs = validQueues[q].erlangs;
        if (qErlangs <= 0) {
          weights[q] = 0.001;
        } else {
          // Shift capacity toward queues with higher relative load (A_q / N_q)
          const currentOccRatio = qErlangs / Math.max(0.5, effAgentsPerQ[q]);
          weights[q] = Math.max(0.01, alloc[g][q] * Math.pow(currentOccRatio, 0.6));
        }
        weightSum += weights[q];
      }

      if (weightSum > 0) {
        for (let q = 0; q < numQ; q++) {
          if (canServe[g][q]) {
            alloc[g][q] = groupAgents * (weights[q] / weightSum);
          }
        }
      }
    }
  }

  // Compute Effective Dedicated Agents and Total Qualified Agents per Queue
  const queueResults = validQueues.map((q, qIdx) => {
    let effectiveAgents = 0;
    let totalQualifiedAgents = 0;
    let sharedCrossSkilledAgents = 0;
    const contributingGroups = [];

    for (let g = 0; g < numG; g++) {
      if (canServe[g][qIdx] && validGroups[g].agents > 0) {
        effectiveAgents += alloc[g][qIdx];
        totalQualifiedAgents += validGroups[g].agents;
        if (validGroups[g].skills.length > 1) {
          sharedCrossSkilledAgents += validGroups[g].agents;
        }
        contributingGroups.push({
          groupName: validGroups[g].name,
          allocatedAgents: alloc[g][qIdx],
          totalGroupAgents: validGroups[g].agents
        });
      }
    }

    // No qualified agents at all
    if (totalQualifiedAgents === 0 && q.erlangs > 0) {
      const minForSla = findRequiredAgents(
        q.erlangs,
        q.ahtSeconds,
        targetSlPercent,
        targetTimeSeconds
      );
      return {
        ...q,
        effectiveAgents: 0,
        totalQualifiedAgents: 0,
        contributingGroups,
        occupancyPercent: 100,
        serviceLevelPercent: 0,
        asaSeconds: Infinity,
        isStable: false,
        requiredAgentsForTarget: minForSla,
        verdict: {
          status: 'red',
          label: 'No Skilled Agents',
          headline: `0 agents possess required skill "${q.requiredSkill}"`
        }
      };
    }

    // Pooling synergy adjustment: multi-skilled agents reduce random idle time across queues.
    // We blend the Erlang C wait probability between the strict dedicated slice (Math.round(effectiveAgents))
    // and the broader qualified pool at the same utilization level.
    const dedicatedN = Math.max(1, Math.round(effectiveAgents));
    const baseEval = evaluateContactCenter({
      callsPerHour: q.callsPerHour,
      ahtSeconds: q.ahtSeconds,
      agents: dedicatedN,
      targetSlPercent,
      targetTimeSeconds
    });

    // If queue has cross-trained agents sharing load, compute pooling efficiency boost
    let finalSl = baseEval.serviceLevelPercent;
    let finalAsa = baseEval.asaSeconds;
    const isStable = effectiveAgents > q.erlangs;
    const rawOcc = effectiveAgents > 0 ? (q.erlangs / effectiveAgents) * 100 : 100;
    const occupancyPercent = q.erlangs === 0 ? 0 : Math.min(100, rawOcc);

    if (isStable && q.erlangs > 0) {
      // Fractional Erlang C interpolation between floor(effectiveAgents) and ceil(effectiveAgents)
      // plus a modest pooling bonus when backed by a larger multi-skilled pool
      const sharingRatio =
        totalQualifiedAgents > effectiveAgents
          ? Math.min(1, (totalQualifiedAgents - effectiveAgents) / Math.max(1, totalQualifiedAgents))
          : 0;
      const effectivePooledN = effectiveAgents + sharingRatio * Math.min(2.5, effectiveAgents * 0.12);

      const nLow = Math.max(Math.floor(q.erlangs) + 1, Math.floor(effectivePooledN));
      const nHigh = nLow + 1;
      const frac = Math.max(0, Math.min(1, effectivePooledN - nLow));

      const evalLow = evaluateContactCenter({
        callsPerHour: q.callsPerHour,
        ahtSeconds: q.ahtSeconds,
        agents: nLow,
        targetSlPercent,
        targetTimeSeconds
      });
      const evalHigh = evaluateContactCenter({
        callsPerHour: q.callsPerHour,
        ahtSeconds: q.ahtSeconds,
        agents: nHigh,
        targetSlPercent,
        targetTimeSeconds
      });

      finalSl = evalLow.serviceLevelPercent * (1 - frac) + evalHigh.serviceLevelPercent * frac;
      finalAsa = evalLow.asaSeconds * (1 - frac) + evalHigh.asaSeconds * frac;
    } else if (!isStable && q.erlangs > 0) {
      finalSl = 0;
      finalAsa = Infinity;
    }

    const status = !isStable
      ? 'red'
      : finalSl >= targetSlPercent
      ? 'green'
      : finalSl >= targetSlPercent - 5
      ? 'yellow'
      : 'red';

    return {
      ...q,
      effectiveAgents,
      totalQualifiedAgents,
      contributingGroups,
      occupancyPercent,
      serviceLevelPercent: finalSl,
      asaSeconds: finalAsa,
      isStable,
      requiredAgentsForTarget: baseEval.requiredAgentsForTarget,
      verdict: {
        status,
        label:
          status === 'green'
            ? 'Meets SLA'
            : status === 'yellow'
            ? 'Borderline'
            : isStable
            ? 'Below SLA'
            : 'Overloaded'
      }
    };
  });

  // Compute Agent Group Utilization breakdown
  const groupResults = validGroups.map((g, gIdx) => {
    let busyErlangsCovered = 0;
    const queueShares = [];

    for (let q = 0; q < numQ; q++) {
      if (canServe[gIdx][q] && alloc[gIdx][q] > 0) {
        const qRes = queueResults[q];
        const qBusyErlangs =
          qRes.effectiveAgents > 0
            ? Math.min(qRes.effectiveAgents, qRes.erlangs) * (alloc[gIdx][q] / qRes.effectiveAgents)
            : 0;
        busyErlangsCovered += qBusyErlangs;
        queueShares.push({
          queueName: qRes.name,
          allocatedAgents: alloc[gIdx][q],
          sharePercent: g.agents > 0 ? (alloc[gIdx][q] / g.agents) * 100 : 0
        });
      }
    }

    const groupOccupancy =
      g.agents > 0 ? Math.min(100, (busyErlangsCovered / g.agents) * 100) : 0;

    return {
      ...g,
      busyErlangsCovered,
      occupancyPercent: groupOccupancy,
      queueShares,
      isIdleUnmatched: queueShares.length === 0 && g.agents > 0
    };
  });

  // Aggregate Center-Wide SBR Metrics
  let totalGrossCalls = 0;
  let totalAiDeflectedCalls = 0;
  let totalCalls = 0;
  let totalErlangs = 0;
  let weightedSlSum = 0;
  let weightedAsaSum = 0;
  let anyQueueUnstable = false;
  let sumQueueMinAgents = 0;

  queueResults.forEach((qr) => {
    totalGrossCalls += qr.grossCallsPerHour;
    totalAiDeflectedCalls += qr.aiDeflectedCalls;
    totalCalls += qr.callsPerHour;
    totalErlangs += qr.erlangs;
    sumQueueMinAgents += qr.requiredAgentsForTarget;
    weightedSlSum += qr.serviceLevelPercent * qr.callsPerHour;
    if (!qr.isStable && qr.callsPerHour > 0) {
      anyQueueUnstable = true;
    } else {
      weightedAsaSum += qr.asaSeconds * qr.callsPerHour;
    }
  });

  const totalAgents = validGroups.reduce((acc, g) => acc + g.agents, 0);
  const centerSl = totalCalls > 0 ? weightedSlSum / totalCalls : 100;
  const centerAsa = totalCalls === 0 ? 0 : anyQueueUnstable ? Infinity : weightedAsaSum / totalCalls;
  const centerOccupancy =
    totalErlangs === 0 ? 0 : Math.min(100, (totalErlangs / Math.max(1, totalAgents)) * 100);

  const centerStatus = anyQueueUnstable
    ? 'red'
    : centerSl >= targetSlPercent
    ? 'green'
    : centerSl >= targetSlPercent - 5
    ? 'yellow'
    : 'red';

  return {
    queues: queueResults,
    agentGroups: groupResults,
    summary: {
      totalGrossCalls,
      totalAiDeflectedCalls,
      totalCalls,
      totalErlangs,
      totalAgents,
      sumQueueMinAgents,
      serviceLevelPercent: centerSl,
      asaSeconds: centerAsa,
      occupancyPercent: centerOccupancy,
      isStable: !anyQueueUnstable,
      status: centerStatus
    }
  };
}

// Export for Node.js testing while keeping browser global compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateWorkloadErlangs,
    calculateVoicebotDeflection,
    calculateProbabilityOfWaiting,
    evaluateContactCenter,
    findRequiredAgents,
    evaluateMultiQueueCenter,
    evaluateSkillBasedRouting
  };
}
