/** Token meter model for the side panel. Replaced by live accounting in M1. */
export interface TokenMeter {
  yourUsed: number;
  yourLimit: number;
  companyUsedPercent: number;
}

export const INITIAL_TOKEN_METER: TokenMeter = {
  yourUsed: 1310,
  yourLimit: 2811,
  companyUsedPercent: 25,
};

export function usedPercent(meter: TokenMeter): number {
  if (meter.yourLimit <= 0) return 0;
  return Math.min(100, Math.round((meter.yourUsed / meter.yourLimit) * 100));
}

export function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}
