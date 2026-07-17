import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const validator = join(here, 'validate-receipt.mjs');

function validReceipt() {
  return {
    schemaVersion: 1,
    currentMessageReviewed: true,
    transcript: {
      status: 'complete',
      source: 'conversation-api',
      firstTurn: 'first',
      lastTurn: 'latest',
    },
    attachments: { status: 'complete', reviewed: [] },
    referencedResources: { status: 'complete', reviewed: [] },
    privateSources: {
      status: 'not_applicable',
      reviewed: [],
      notApplicableReason: 'No relevant private source',
    },
    publicSources: {
      status: 'not_applicable',
      reviewed: [],
      notApplicableReason: 'No current public fact required',
    },
    contradictions: { status: 'resolved', items: [] },
    unresolvedMaterialReferences: [],
    answerBasis: ['full transcript'],
    reviewedAt: '2026-07-18T00:00:00.000Z',
  };
}

function validate(receipt) {
  return spawnSync(process.execPath, [validator], {
    input: JSON.stringify(receipt),
    encoding: 'utf8',
  });
}

test('accepts a complete context review receipt', () => {
  const result = validate(validReceipt());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok":true/);
});

test('rejects a partial or unavailable transcript', () => {
  const receipt = validReceipt();
  receipt.transcript.status = 'partial';
  const result = validate(receipt);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /transcript\.status must be complete/);
});

test('rejects unresolved material references', () => {
  const receipt = validReceipt();
  receipt.unresolvedMaterialReferences = ['Pasted text(46).txt'];
  const result = validate(receipt);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unresolvedMaterialReferences must be empty/);
});

test('rejects not-applicable source sections without reasons', () => {
  const receipt = validReceipt();
  receipt.privateSources.notApplicableReason = '';
  const result = validate(receipt);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /privateSources\.notApplicableReason/);
});

test('rejects unresolved contradictions', () => {
  const receipt = validReceipt();
  receipt.contradictions.status = 'unresolved';
  receipt.contradictions.items = ['Two incompatible prior decisions'];
  const result = validate(receipt);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /contradictions\.status must be resolved/);
});

test('rejects a receipt that did not review the latest user message', () => {
  const receipt = validReceipt();
  receipt.currentMessageReviewed = false;
  const result = validate(receipt);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /currentMessageReviewed must be true/);
});
