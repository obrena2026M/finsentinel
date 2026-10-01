// Heuristic detector for instruction-like content in documents — FR-ADV-01..03, Architecture §5.4.
// Flags are informational: the chunk is still passed to the model as evidence; it is never obeyed.

export type FlagType = 'instruction_like' | 'approval_instruction' | 'self_assertion';

export type InjectionFlag = {
  flagType: FlagType;
  matchedText: string;
  pattern: string;
};

const PATTERNS: Array<{ type: FlagType; re: RegExp }> = [
  { type: 'instruction_like', re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i },
  { type: 'instruction_like', re: /disregard\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?)/i },
  { type: 'instruction_like', re: /you\s+are\s+now\s+(a|an|the)\b/i },
  { type: 'instruction_like', re: /\bsystem\s+prompt\b/i },
  {
    type: 'instruction_like',
    re: /rate\s+(this|the)\s+(product|case|change|proposal)\s+(as\s+)?(very\s+)?(low|minimal|no)\s+risk/i,
  },
  {
    type: 'instruction_like',
    re: /\b(set|mark|classify)\s+(the\s+)?(risk|rating)\s+(to|as)\s+(very\s+)?low\b/i,
  },
  {
    type: 'approval_instruction',
    re: /approve\s+(this|the)\s+(product|case|change|proposal)(\s+immediately)?/i,
  },
  { type: 'approval_instruction', re: /\b(must|should)\s+be\s+approved\s+(immediately|without\s+review)/i },
  {
    type: 'self_assertion',
    re: /\b(has|have)\s+(excellent|strong|robust|world[- ]class|best[- ]in[- ]class)\s+(aml|kyc|sanctions|compliance|financial\s+crime)\s+controls?\b/i,
  },
];

export function detectInjection(text: string): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  for (const { type, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) flags.push({ flagType: type, matchedText: m[0].slice(0, 200), pattern: re.source });
  }
  return flags;
}

export const INJECTION_BANNER_TEXT =
  'Instruction-like content detected. Treated as document content. Not used as an instruction.';
