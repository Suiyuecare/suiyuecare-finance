export type InsuranceGrade = {
  id: string;
  level: number;
  amount: number;
  minSalary: number;
  maxSalary: number | null;
};

export type InsuranceRateSettings = {
  laborInsuranceRate: number;
  laborEmployeeShare: number;
  laborEmployerShare: number;
  healthInsuranceRate: number;
  healthEmployeeShare: number;
  healthEmployerShare: number;
  healthDependentCap: number;
  healthEmployerDependentFactor: number;
  laborPensionEmployerRate: number;
  supplementaryNhiRate: number;
};

export type InsuranceCalculationInput = {
  monthlySalary: number;
  dependents: number;
  supplementaryIncome: number;
  laborGrades: InsuranceGrade[];
  healthGrades: InsuranceGrade[];
  rates: InsuranceRateSettings;
};

export type InsuranceCalculationResult = {
  laborGrade: InsuranceGrade;
  healthGrade: InsuranceGrade;
  laborEmployeePremium: number;
  laborEmployerPremium: number;
  healthEmployeePremium: number;
  healthEmployerPremium: number;
  laborPensionEmployerContribution: number;
  supplementaryNhiPremium: number;
  employeeTotal: number;
  employerTotal: number;
};

export const defaultInsuranceRateSettings: InsuranceRateSettings = {
  laborInsuranceRate: 0.125,
  laborEmployeeShare: 0.2,
  laborEmployerShare: 0.7,
  healthInsuranceRate: 0.0517,
  healthEmployeeShare: 0.3,
  healthEmployerShare: 0.6,
  healthDependentCap: 3,
  healthEmployerDependentFactor: 1.57,
  laborPensionEmployerRate: 0.06,
  supplementaryNhiRate: 0.0211,
};

export const defaultLaborInsuranceGrades: InsuranceGrade[] = [
  { id: "L-01", level: 1, amount: 29500, minSalary: 0, maxSalary: 29500 },
  { id: "L-02", level: 2, amount: 30300, minSalary: 29501, maxSalary: 30300 },
  { id: "L-03", level: 3, amount: 31800, minSalary: 30301, maxSalary: 31800 },
  { id: "L-04", level: 4, amount: 33300, minSalary: 31801, maxSalary: 33300 },
  { id: "L-05", level: 5, amount: 34800, minSalary: 33301, maxSalary: 34800 },
  { id: "L-06", level: 6, amount: 36300, minSalary: 34801, maxSalary: 36300 },
  { id: "L-07", level: 7, amount: 38200, minSalary: 36301, maxSalary: 38200 },
  { id: "L-08", level: 8, amount: 40100, minSalary: 38201, maxSalary: 40100 },
  { id: "L-09", level: 9, amount: 42000, minSalary: 40101, maxSalary: 42000 },
  { id: "L-10", level: 10, amount: 43900, minSalary: 42001, maxSalary: 43900 },
  { id: "L-11", level: 11, amount: 45800, minSalary: 43901, maxSalary: null },
];

export const defaultHealthInsuranceGrades: InsuranceGrade[] = [
  { id: "H-01", level: 1, amount: 29500, minSalary: 0, maxSalary: 29500 },
  { id: "H-02", level: 2, amount: 30300, minSalary: 29501, maxSalary: 30300 },
  { id: "H-03", level: 3, amount: 31800, minSalary: 30301, maxSalary: 31800 },
  { id: "H-04", level: 4, amount: 33300, minSalary: 31801, maxSalary: 33300 },
  { id: "H-05", level: 5, amount: 34800, minSalary: 33301, maxSalary: 34800 },
  { id: "H-06", level: 6, amount: 36300, minSalary: 34801, maxSalary: 36300 },
  { id: "H-07", level: 7, amount: 38200, minSalary: 36301, maxSalary: 38200 },
  { id: "H-08", level: 8, amount: 40100, minSalary: 38201, maxSalary: 40100 },
  { id: "H-09", level: 9, amount: 42000, minSalary: 40101, maxSalary: 42000 },
  { id: "H-10", level: 10, amount: 43900, minSalary: 42001, maxSalary: 43900 },
  { id: "H-11", level: 11, amount: 45800, minSalary: 43901, maxSalary: 45800 },
  { id: "H-12", level: 12, amount: 48200, minSalary: 45801, maxSalary: null },
];

function roundMoney(value: number) {
  return Math.round(value);
}

export function findInsuranceGrade(monthlySalary: number, grades: InsuranceGrade[]) {
  const sortedGrades = [...grades].sort((a, b) => a.amount - b.amount);
  return (
    sortedGrades.find((grade) => monthlySalary >= grade.minSalary && (grade.maxSalary === null || monthlySalary <= grade.maxSalary)) ??
    sortedGrades[sortedGrades.length - 1]
  );
}

export function calculateInsurancePremiums(input: InsuranceCalculationInput): InsuranceCalculationResult {
  const laborGrade = findInsuranceGrade(input.monthlySalary, input.laborGrades);
  const healthGrade = findInsuranceGrade(input.monthlySalary, input.healthGrades);
  const dependentCount = Math.min(Math.max(input.dependents, 0), input.rates.healthDependentCap);
  const insuredPersonsForEmployee = 1 + dependentCount;

  const laborEmployeePremium = roundMoney(laborGrade.amount * input.rates.laborInsuranceRate * input.rates.laborEmployeeShare);
  const laborEmployerPremium = roundMoney(laborGrade.amount * input.rates.laborInsuranceRate * input.rates.laborEmployerShare);
  const healthEmployeePremium = roundMoney(healthGrade.amount * input.rates.healthInsuranceRate * input.rates.healthEmployeeShare * insuredPersonsForEmployee);
  const healthEmployerPremium = roundMoney(healthGrade.amount * input.rates.healthInsuranceRate * input.rates.healthEmployerShare * input.rates.healthEmployerDependentFactor);
  const laborPensionEmployerContribution = roundMoney(laborGrade.amount * input.rates.laborPensionEmployerRate);
  const supplementaryNhiPremium = roundMoney(Math.max(input.supplementaryIncome, 0) * input.rates.supplementaryNhiRate);

  return {
    laborGrade,
    healthGrade,
    laborEmployeePremium,
    laborEmployerPremium,
    healthEmployeePremium,
    healthEmployerPremium,
    laborPensionEmployerContribution,
    supplementaryNhiPremium,
    employeeTotal: laborEmployeePremium + healthEmployeePremium + supplementaryNhiPremium,
    employerTotal: laborEmployerPremium + healthEmployerPremium + laborPensionEmployerContribution,
  };
}

