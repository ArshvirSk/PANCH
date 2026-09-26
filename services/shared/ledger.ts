import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { CaseStatus, LedgerEvent } from './types';
import { computeEntryHash } from './hashing';

const ddbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(ddbClient);

const CASES_TABLE = process.env.CASES_TABLE || '';
const LEDGER_TABLE = process.env.LEDGER_TABLE || '';

export interface LedgerTransition {
  caseId: string;
  event: LedgerEvent;
  amountCents: number;
  payeeBps?: number;
  expectedStatus: CaseStatus;
  newStatus: CaseStatus;
  seq: number;
  prevHash: string;
}

/**
 * Validates the state machine transitions.
 */
export function validateTransition(currentStatus: CaseStatus, event: LedgerEvent): CaseStatus {
  switch (event) {
    case LedgerEvent.FUND:
      if (currentStatus !== CaseStatus.CREATED) throw new Error(`Illegal transition: ${currentStatus} -> FUND`);
      return CaseStatus.FUNDED;
    case LedgerEvent.DISPUTE:
      if (currentStatus !== CaseStatus.FUNDED) throw new Error(`Illegal transition: ${currentStatus} -> DISPUTE`);
      return CaseStatus.DISPUTED; // After DISPUTE, it goes to DELIBERATING via /submit, but that's a case status change, not ledger event
    case LedgerEvent.RESOLVE:
      if (currentStatus === CaseStatus.RULED || currentStatus === CaseStatus.SETTLED) throw new Error('Double-resolve rejected');
      // Typically transitions from ESCALATED or DELIBERATING, but technically any state before RULED is functionally valid for the ledger if arbitration concludes. We'll enforce it was DELIBERATING or ESCALATED.
      if (currentStatus !== CaseStatus.DELIBERATING && currentStatus !== CaseStatus.ESCALATED) throw new Error(`Illegal transition: ${currentStatus} -> RESOLVE`);
      return CaseStatus.RULED;
    case LedgerEvent.RELEASE:
      if (currentStatus !== CaseStatus.RULED) throw new Error(`Illegal transition: ${currentStatus} -> RELEASE`);
      return CaseStatus.SETTLED;
    default:
      throw new Error(`Unknown event ${event}`);
  }
}

/**
 * Appends a ledger entry and updates case status via a DynamoDB Transaction.
 */
export async function appendLedgerEntry(input: LedgerTransition) {
  const entryHash = computeEntryHash(input.prevHash, input.event, input.amountCents, input.caseId);
  
  const cmd = new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: LEDGER_TABLE,
          Item: {
            caseId: input.caseId,
            seq: input.seq,
            event: input.event,
            amountCents: input.amountCents,
            payeeBps: input.payeeBps,
            prevHash: input.prevHash,
            entryHash: entryHash,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(caseId) AND attribute_not_exists(seq)'
        }
      },
      {
        Update: {
          TableName: CASES_TABLE,
          Key: { caseId: input.caseId },
          UpdateExpression: 'SET #st = :newStatus',
          ConditionExpression: '#st = :expectedStatus',
          ExpressionAttributeNames: {
            '#st': 'status'
          },
          ExpressionAttributeValues: {
            ':newStatus': input.newStatus,
            ':expectedStatus': input.expectedStatus
          }
        }
      }
    ]
  });

  try {
    await docClient.send(cmd);
    return { entryHash };
  } catch (err: any) {
    if (err.name === 'TransactionCanceledException') {
      throw new Error('Transaction canceled: status mismatch or sequence conflict (double-entry).');
    }
    throw err;
  }
}
