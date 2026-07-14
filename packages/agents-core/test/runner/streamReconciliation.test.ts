import { describe, expect, it } from 'vitest';

import {
  buildAbortReconciliationInput,
  createStreamAbortReconciliationState,
  recordStreamEventForAbortReconciliation,
  shouldReconcileStreamAbort,
} from '../../src/runner/streamReconciliation';

describe('stream abort reconciliation', () => {
  it('preserves Programmatic Tool Calling caller linkage', () => {
    const state = createStreamAbortReconciliationState();

    recordStreamEventForAbortReconciliation(state, {
      type: 'model',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'lookup',
          arguments: '{}',
          caller: { type: 'program', caller_id: 'call_prog_1' },
        },
      },
    });

    expect(buildAbortReconciliationInput(state)).toEqual([
      {
        type: 'function_call_result',
        name: 'lookup',
        callId: 'call_1',
        status: 'incomplete',
        output: { type: 'text', text: 'aborted' },
        caller: { type: 'program', callerId: 'call_prog_1' },
      },
    ]);
  });

  it('reconciles programs that have no program output', () => {
    const state = createStreamAbortReconciliationState();

    recordStreamEventForAbortReconciliation(state, {
      type: 'model',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'program',
          id: 'prog_1',
          call_id: 'call_prog_1',
          code: 'text("done");',
          fingerprint: 'fingerprint:program-1',
        },
      },
    });

    expect(shouldReconcileStreamAbort(state)).toBe(true);
    expect(buildAbortReconciliationInput(state)).toEqual([
      {
        type: 'program_output',
        callId: 'call_prog_1',
        status: 'incomplete',
        output: 'aborted',
      },
    ]);
  });

  it('does not reconcile programs that already have an output', () => {
    const state = createStreamAbortReconciliationState();

    for (const item of [
      {
        type: 'program',
        id: 'prog_1',
        call_id: 'call_prog_1',
        code: 'text("done");',
        fingerprint: 'fingerprint:program-1',
      },
      {
        type: 'program_output',
        id: 'prog_out_1',
        call_id: 'call_prog_1',
        result: 'done',
        status: 'completed',
      },
    ]) {
      recordStreamEventForAbortReconciliation(state, {
        type: 'model',
        event: {
          type: 'response.output_item.done',
          item,
        },
      });
    }

    expect(shouldReconcileStreamAbort(state)).toBe(false);
    expect(buildAbortReconciliationInput(state)).toEqual([]);
  });
});
