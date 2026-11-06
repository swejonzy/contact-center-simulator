# Contact Center Capacity Simulator (Version 1.0)

A clean, single-page browser-based Contact Center capacity simulator powered by a numerically stable **Erlang C** engine.

## Features
- **Inputs**:
  - Inflow (calls per hour)
  - Average Handling Time (AHT) in seconds
  - Scheduled / Available Agents (`N`)
  - Target Service Level (%) and Target Answer Time threshold (seconds)
- **Calculated KPIs**:
  - **Workload (Erlangs)**: Traffic intensity $A = \frac{\text{Calls/hr} \times \text{AHT}}{3600}$
  - **Estimated Service Level (%)**: Percentage of calls answered within the target threshold
  - **Estimated Occupancy (%)**: Productive agent utilization (logically capped at 100%)
  - **Average Speed of Answer (ASA)**: Expected average wait time in seconds
  - **Staffing Verdict Banner**: Instant **Green / Yellow / Red** indicator + exact minimum agent recommendation
  - **What-If Sensitivity Table**: Shows neighbouring staffing levels (`N - 3` to `N + 3`)

## Running Locally
Simply open `index.html` in any modern web browser, or serve the folder locally:
```bash
npx serve .
```

## Running Unit Tests
```bash
node test-erlang.js
```
