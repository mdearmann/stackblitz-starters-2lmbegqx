// Constants and Safety Limits
const CONSTANTS = {
  LB_TO_KG: 0.453592,
  IN_TO_CM: 2.54,
  UMOL_TO_MG_DL: 0.0113,
  V_FACTOR: 0.51 // Adane 2015 volume of distribution factor L/kg
};

const SAFETY_LIMITS = {
  age: { min: 18, max: 120 },
  weight: { min: 20, max: 300 }, // kg
  height: { min: 120, max: 250 }, // cm
  creatinine: { min: 0.2, max: 15 }, // mg/dL
  maxSingleDose: 3000,
  minDose: 500,
  targetAUC: { min: 400, max: 600 },
  targetTrough: { min: 10, max: 20 },
  crCl: { warning: 30, critical: 15 }
};

// Patient Calculator Class
class PatientCalculator {
  constructor() {
      this.sex = 'male';
      this.values = {
          age: 0,
          weight: 0,  // in kg
          height: 0,  // in inches
          creatinine: 0  // in mg/dL
      };
  }

  calculateBSA(heightInCm, weightInKg) {
      return Math.sqrt((heightInCm * weightInKg) / 3600);
  }

  calculateIBW() {
      const heightInInches = this.values.height;
      const baseWeight = this.sex === 'male' ? 50 : 45.5;
      return baseWeight + 2.3 * (heightInInches - 60);
  }

  calculateAdjBW() {
      const actualWeight = this.values.weight;
      const ibw = this.calculateIBW();
      return actualWeight > ibw * 1.2 ? ibw + 0.4 * (actualWeight - ibw) : actualWeight;
  }

  calculateCrCl() {
      const weightInKg = this.calculateAdjBW();
      const creatinine = this.values.creatinine;

      if (creatinine === 0) return 0;

      let crCl = ((140 - this.values.age) * weightInKg) / (72 * creatinine);
      if (this.sex === 'female') crCl *= 0.85;

      return Math.round(crCl * 10) / 10;
  }
}

// Vancomycin Calculator Class
class VancomycinCalculator {
  calculateVd(weight) {
      return CONSTANTS.V_FACTOR * weight;
  }

  calculateVancClearance(crCl) {
      return 6.54 * crCl / 125;
  }

  calculateKel(clVanc, vd) {
      return clVanc / vd;
  }

  calculateCmaxSS(dose, vd, k, t_inf) {
      return (dose * (1 - Math.exp(-k * t_inf))) / (vd * k * t_inf * (1 - Math.exp(-k * t_inf)));
  }

  calculateCminSS(peak, k, tau, t_inf) {
      return peak * Math.exp(-k * (tau - t_inf));
  }

  calculateAUC(peak, trough, tau, t_inf) {
      // Linear Trapezoidal
      const linTrap = ((peak + trough) / 2) * t_inf;
      
      // Logarithmic Trapezoidal
      const logTrap = ((peak - trough) * (tau - t_inf)) / Math.log(peak / trough);
      
      // AUC for one dosing interval
      const aucTau = linTrap + logTrap;
      
      // Convert to AUC24
      return (aucTau * 24) / tau;
  }

  getDoseRecommendations(weight, crCl, frequency = 12) {
      const vd = this.calculateVd(weight);
      const clVanc = this.calculateVancClearance(crCl);
      const k = this.calculateKel(clVanc, vd);
      
      // Calculate dose range based on mg/kg
      const doseRanges = {
          12: [5, 7, 9], // mg/kg for q12h
          24: [7, 9, 11, 12], // mg/kg for q24h
          48: [12, 14, 16, 18] // mg/kg for q48h
      };

      const doses = doseRanges[frequency].map(mgPerKg => {
          const dose = Math.round(mgPerKg * weight / 100) * 100;
          const infusionTime = 1;
          const peak = this.calculateCmaxSS(dose, vd, k, infusionTime);
          const trough = this.calculateCminSS(peak, k, frequency, infusionTime);
          const auc = this.calculateAUC(peak, trough, frequency, infusionTime);

          return {
              dose,
              mgPerKg,
              peak,
              trough,
              auc
          };
      });

      return {
          k,
          vd,
          clVanc,
          doses
      };
  }
}

// Initialize calculators
const patientCalc = new PatientCalculator();
const vancCalc = new VancomycinCalculator();
let concentrationChart = null;

// UI Update Functions
function showWarning(message, type = 'warning') {
  const warningDiv = document.getElementById('warning-messages');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} alert-dismissible fade show`;
  alert.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  warningDiv.appendChild(alert);
  setTimeout(() => alert.remove(), 5000);
}

function updatePKDisplay(dose, frequency, infusionTime, auc, peak, trough) {
  document.getElementById('pk-dose').textContent = 
      `${dose} mg q${frequency}h (over ${infusionTime} hr)`;
  document.getElementById('pk-auc').textContent = 
      `${auc.toFixed(1)} mcg*hr/mL`;
  document.getElementById('pk-peak').textContent = 
      `${peak.toFixed(1)} mcg/mL`;
  document.getElementById('pk-trough').textContent = 
      `${trough.toFixed(1)} mcg/mL`;
}

function updateDosingTable(recommendations) {
  const tbody = document.getElementById('dose-table-body');
  
  // Clear existing content
  tbody.innerHTML = `
      <tr class="table-header">
          <th>Dose</th>
          <th>AUC₂₄/MIC<br>(mcg*hr/mL)</th>
          <th>Peak<br>(mcg/mL)</th>
          <th>Trough<br>(mcg/mL)</th>
          <th></th>
      </tr>`;

  // Add rows for each dose
  recommendations.doses.forEach((dose, index) => {
      const isOptimal = dose.auc >= 400 && dose.auc <= 600;
      const isSuggested = dose.auc >= 500 && dose.auc <= 600;
      
      const row = document.createElement('tr');
      row.innerHTML = `
          <td>${dose.dose} mg (${dose.mgPerKg} mg/kg)</td>
          <td class="${isOptimal ? 'optimal-auc' : ''}">${dose.auc.toFixed(0)}</td>
          <td>${dose.peak.toFixed(1)}</td>
          <td>${dose.trough.toFixed(1)}</td>
          <td>
              <button class="btn ${isSuggested ? 'btn-success' : 'btn-primary'} btn-sm" 
                      onclick="selectDose(${dose.dose}, ${getCurrentFrequency()})">
                  ${isSuggested ? 'Suggested' : 'Select'}
              </button>
          </td>
      `;
      tbody.appendChild(row);
  });
}

function getCurrentFrequency() {
  const activeFreqButton = document.querySelector('#frequency-toggles .btn-primary');
  return parseInt(activeFreqButton.dataset.freq);
}

function updateConcentrationGraph(dose, tau, k, V, t_inf = 1) {
  const ctx = document.getElementById('pk-graph').getContext('2d');
  const timePoints = [0, 10, 20, 30, 40, 50, 60];

  const concentrations = timePoints.map(t => {
      let concentration = 0;
      const numDoses = Math.floor(t / tau);

      for (let i = 0; i <= numDoses; i++) {
          const t_since_dose = t - (i * tau);
          if (t_since_dose >= 0) {
              if (t_since_dose <= t_inf) {
                  concentration += (dose / (V * k * t_inf)) * 
                      (1 - Math.exp(-k * t_since_dose));
              } else {
                  concentration += (dose / (V * k * t_inf)) * 
                      (1 - Math.exp(-k * t_inf)) * 
                      Math.exp(-k * (t_since_dose - t_inf));
              }
          }
      }
      return concentration;
  });

  const newData = {
      labels: timePoints,
      datasets: [{
          label: 'Concentration',
          data: concentrations,
          borderColor: '#7C9082',
          backgroundColor: 'rgba(124, 144, 130, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointBackgroundColor: '#7C9082'
      }]
  };

  if (concentrationChart) {
      concentrationChart.destroy();
  }

  concentrationChart = new Chart(ctx, {
      type: 'line',
      data: newData,
      options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
              tooltip: {
                  mode: 'index',
                  intersect: false,
                  callbacks: {
                      label: function(context) {
                          return `Concentration: ${context.parsed.y.toFixed(1)} mcg/mL`;
                      }
                  }
              }
          },
          scales: {
              x: {
                  title: {
                      display: true,
                      text: 'Time (h)',
                      font: { size: 14 }
                  },
                  ticks: {
                      stepSize: 10,
                      max: 60
                  }
              },
              y: {
                  title: {
                      display: true,
                      text: 'Concentration (mcg/mL)',
                      font: { size: 14 }
                  },
                  min: 0,
                  max: 30,
                  ticks: {
                      stepSize: 10
                  }
              }
          }
      }
  });

  addTargetRanges(concentrationChart);
}

function addTargetRanges(chart) {
  const targetMin = 10;
  const targetMax = 20;

  chart.data.datasets.push({
      label: 'Target Range',
      data: chart.data.labels.map(() => targetMax),
      backgroundColor: 'rgba(0, 255, 0, 0.1)',
      borderColor: 'transparent',
      fill: '+1'
  });

  chart.data.datasets.push({
      label: 'Target Min',
      data: chart.data.labels.map(() => targetMin),
      borderColor: 'rgba(0, 200, 0, 0.5)',
      borderDash: [5, 5],
      borderWidth: 1,
      pointRadius: 0,
      fill: false
  });

  chart.update();
}

// Event Handlers
document.getElementById('calculate-btn').addEventListener('click', () => {
  const crCl = patientCalc.calculateCrCl();

  if (crCl < SAFETY_LIMITS.crCl.critical) {
      showWarning('CRITICAL: CrCl < 15 mL/min. Consider alternative therapy.', 'danger');
      return;
  }
  if (crCl < SAFETY_LIMITS.crCl.warning) {
      showWarning('WARNING: CrCl < 30 mL/min. Dose reduction required.', 'warning');
  }

  const results = vancCalc.getDoseRecommendations(
      patientCalc.calculateAdjBW(),
      crCl,
      getCurrentFrequency()
  );

  updateDosingTable(results);

  // Find suggested dose
  const suggestedDose = results.doses.find(d => d.auc >= 500 && d.auc <= 600);
  if (suggestedDose) {
      const infusionTime = 1;
      
      document.getElementById('dose-input').value = suggestedDose.dose;
      document.getElementById('frequency-input').value = getCurrentFrequency();
      document.getElementById('infusion-input').value = infusionTime;
      
      updatePKDisplay(
          suggestedDose.dose, 
          getCurrentFrequency(), 
          infusionTime,
          suggestedDose.auc,
          suggestedDose.peak,
          suggestedDose.trough
      );

      updateConcentrationGraph(suggestedDose.dose, getCurrentFrequency(), results.k, results.vd);
  }
});

// Input event listeners
['age', 'weight', 'height', 'creatinine'].forEach(field => {
  const input = document.getElementById(`${field}-input`);
  if (input) {
      input.addEventListener('input', (e) => {
          patientCalc.values[field] = parseFloat(e.target.value) || 0;
      });
  }
});

// Sex selection listeners
document.querySelectorAll('[data-sex]').forEach(button => {
  button.addEventListener('click', (e) => {
      document.querySelectorAll('[data-sex]').forEach(btn => 
          btn.classList.remove('btn-primary'));
      button.classList.add('btn-primary');
      patientCalc.sex = button.dataset.sex;
  });
});

// Clear button functionality
document.getElementById('clear-btn').addEventListener('click', () => {
  document.querySelectorAll('input[type="number"]').forEach(input => 
      input.value = '');
  document.getElementById('pk-dose').textContent = '-- mg q--h (over -- hr)';
  document.getElementById('pk-auc').textContent = '-- mcg*hr/mL';
  document.getElementById('pk-peak').textContent = '-- mcg/mL';
  document.getElementById('pk-trough').textContent = '-- mcg/mL';
  if (concentrationChart) {
      concentrationChart.destroy();
      concentrationChart = null;
  }
  initializeGraph();
});

function selectDose(dose, frequency) {
  document.getElementById('dose-input').value = dose;
  document.getElementById('frequency-input').value = frequency;
  document.getElementById('infusion-input').value = 1;
  document.getElementById('recalculate-btn').click();
}

// Recalculate button functionality
document.getElementById('recalculate-btn').addEventListener('click', () => {
  const dose = parseFloat(document.getElementById('dose-input').value);
  const frequency = parseFloat(document.getElementById('frequency-input').value);
  const infusionTime = parseFloat(document.getElementById('infusion-input').value) || 1;

  const crCl = patientCalc.calculateCrCl();
  const vd = vancCalc.calculateVd(patientCalc.calculateAdjBW());
  const clVanc = vancCalc.calculateVancClearance(crCl);
  const k = vancCalc.calculateKel(clVanc, vd);

  const peak = vancCalc.calculateCmaxSS(dose, vd, k, infusionTime);
  const trough = vancCalc.calculateCminSS(peak, k, frequency, infusionTime);
  const auc = vancCalc.calculateAUC(peak, trough, frequency, infusionTime);

  updatePKDisplay(dose, frequency, infusionTime, auc, peak, trough);
  updateConcentrationGraph(dose, frequency, k, vd, infusionTime);
});

// Initialize graph function
function initializeGraph() {
  const ctx = document.getElementById('pk-graph').getContext('2d');
  concentrationChart = new Chart(ctx, {
      type: 'line',
      data: {
          labels: [0, 10, 20, 30, 40, 50, 60],
          datasets: [{
              label: 'Concentration',
              data: [0],
              borderColor: '#7C9082',
              backgroundColor: 'rgba(124, 144, 130, 0.1)',
              borderWidth: 2,
              tension: 0.4,
              pointRadius: 0
          }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
              x: {
                  title: {
                      display: true,
                      text: 'Time (h)',
                      font: { size: 14 }
                  },
                  ticks: {
                      stepSize: 10,
                      max: 60
                  }
              },
              y: {
                  title: {
                      display: true,
                      text: 'Concentration (mcg/mL)',
                      font: { size: 14 }
                  },
                  min: 0,
                  max: 30,
                  ticks: {
                      stepSize: 10
                  }
              }
          }
      }
  });

  addTargetRanges(concentrationChart);
}

// Progress Note Generation
document.getElementById('progress-note-btn').addEventListener('click', () => {
  const dose = document.getElementById('dose-input').value;
  const freq = document.getElementById('frequency-input').value;
  const infusion = document.getElementById('infusion-input').value;
  const crCl = patientCalc.calculateCrCl();

  const noteText = `[Patient description, reason for consult]

Patient Metrics
Age:      ${patientCalc.values.age} yrs
Height:   ${patientCalc.values.height} in
Gender:   ${patientCalc.sex.charAt(0).toUpperCase() + patientCalc.sex.slice(1)}
Total BW: ${patientCalc.values.weight} kg
Ideal BW: ${patientCalc.calculateIBW().toFixed(1)} kg
Adjusted BW: ${patientCalc.calculateAdjBW().toFixed(1)} kg
CrCl:     ${crCl.toFixed(0)} mL/min

Recent Doses/Levels
Vancomycin dose: ${dose} mg IV Q${freq}hrs (infused over ${infusion} hrs)
Estimated AUC/MIC: ${document.getElementById('pk-auc').textContent}
Estimated peak: ${document.getElementById('pk-peak').textContent}
Estimated trough: ${document.getElementById('pk-trough').textContent}
Therapeutic target: AUC/MIC 400 to 600 mcg*hr/mL

A/P:
1. Recommend vancomycin ${dose} mg IV Q${freq}hrs
2. [Discuss when next vancomycin level(s) should be obtained based on clinical factors and/or institution policy]
3. Monitor renal function (urine output, BUN/SCr). Dose adjustments may be necessary with a significant change in renal function.

Please contact with questions. Thank you for the consult.
[Signature, contact information]`;

  document.getElementById('progress-note-content').innerText = noteText;
  const modal = new bootstrap.Modal(document.getElementById('progress-note-modal'));
  modal.show();
});

// Copy Note Button Handler
document.getElementById('copy-note-btn').addEventListener('click', () => {
  const noteContent = document.getElementById('progress-note-content').innerText;
  navigator.clipboard.writeText(noteContent)
      .then(() => {
          alert('Progress note copied to clipboard!');
      })
      .catch(err => {
          console.error('Failed to copy text: ', err);
      });
});

// Initialize frequency toggles
const tableContainer = document.querySelector('.table-responsive');
const togglesDiv = document.createElement('div');
togglesDiv.id = 'frequency-toggles';
togglesDiv.innerHTML = `
  <button class="btn btn-primary" data-freq="12">q12h</button>
  <button class="btn btn-outline-primary" data-freq="24">q24h</button>
  <button class="btn btn-outline-primary" data-freq="48">q48h</button>
`;
tableContainer.insertBefore(togglesDiv, tableContainer.firstChild);

// Add frequency toggle event listeners
document.querySelectorAll('#frequency-toggles button').forEach(button => {
  button.addEventListener('click', (e) => {
      document.querySelectorAll('#frequency-toggles button').forEach(btn => {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-outline-primary');
      });
      e.target.classList.remove('btn-outline-primary');
      e.target.classList.add('btn-primary');

      if (document.getElementById('dose-input').value) {
          document.getElementById('calculate-btn').click();
      }
  });
});

// Initialize graph on page load
document.addEventListener('DOMContentLoaded', function() {
  initializeGraph();
});