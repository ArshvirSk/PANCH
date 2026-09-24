import * as crypto from 'crypto';
import { LedgerEvent } from './types';

export function computeEntryHash(
  prevHash: string,
  event: LedgerEvent,
  amountCents: number,
  caseId: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}${event}${amountCents}${caseId}`)
    .digest('hex');
}
