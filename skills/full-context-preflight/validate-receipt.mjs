#!/usr/bin/env node

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkSourceSection(receipt, name, errors) {
  const section = receipt[name];
  if (!isObject(section)) {
    errors.push(`${name} must be an object`);
    return;
  }
  if (!['complete', 'not_applicable'].includes(section.status)) {
    errors.push(`${name}.status must be complete or not_applicable`);
  }
  if (!Array.isArray(section.reviewed)) {
    errors.push(`${name}.reviewed must be an array`);
  }
  if (section.status === 'not_applicable' && !nonEmptyString(section.notApplicableReason)) {
    errors.push(`${name}.notApplicableReason is required when status is not_applicable`);
  }
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const errors = [];
let receipt;

try {
  receipt = JSON.parse(await readStdin());
} catch (error) {
  console.error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!isObject(receipt)) errors.push('receipt must be an object');

if (isObject(receipt)) {
  if (receipt.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (receipt.currentMessageReviewed !== true) errors.push('currentMessageReviewed must be true');

  if (!isObject(receipt.transcript)) {
    errors.push('transcript must be an object');
  } else {
    if (receipt.transcript.status !== 'complete') errors.push('transcript.status must be complete');
    if (!nonEmptyString(receipt.transcript.source)) errors.push('transcript.source must be a non-empty string');
    if (!nonEmptyString(receipt.transcript.firstTurn)) errors.push('transcript.firstTurn must be a non-empty string');
    if (!nonEmptyString(receipt.transcript.lastTurn)) errors.push('transcript.lastTurn must be a non-empty string');
  }

  checkSourceSection(receipt, 'attachments', errors);
  checkSourceSection(receipt, 'referencedResources', errors);
  checkSourceSection(receipt, 'privateSources', errors);
  checkSourceSection(receipt, 'publicSources', errors);

  if (!isObject(receipt.contradictions)) {
    errors.push('contradictions must be an object');
  } else {
    if (receipt.contradictions.status !== 'resolved') errors.push('contradictions.status must be resolved');
    if (!Array.isArray(receipt.contradictions.items)) errors.push('contradictions.items must be an array');
  }

  if (!Array.isArray(receipt.unresolvedMaterialReferences)) {
    errors.push('unresolvedMaterialReferences must be an array');
  } else if (receipt.unresolvedMaterialReferences.length > 0) {
    errors.push('unresolvedMaterialReferences must be empty');
  }

  if (!Array.isArray(receipt.answerBasis) || receipt.answerBasis.length === 0) {
    errors.push('answerBasis must be a non-empty array');
  }

  if (!nonEmptyString(receipt.reviewedAt) || Number.isNaN(Date.parse(receipt.reviewedAt))) {
    errors.push('reviewedAt must be a valid timestamp');
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(2);
}

process.stdout.write(JSON.stringify({ ok: true }) + '\n');
