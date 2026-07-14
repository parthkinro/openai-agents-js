import type { ModelRequest, ModelResponse } from '../model';
import type {
  FunctionCallItem,
  FunctionCallResultItem,
  ProgramCallResultItem,
  StreamEvent,
} from '../types/protocol';

type PendingStreamedFunctionCall = Pick<
  FunctionCallItem,
  'callId' | 'name' | 'namespace' | 'caller'
>;

export type StreamAbortReconciliationState = {
  responseId?: string;
  pendingFunctionCalls: Map<string, PendingStreamedFunctionCall>;
  pendingProgramCalls: Set<string>;
};

export function createStreamAbortReconciliationState(): StreamAbortReconciliationState {
  return {
    pendingFunctionCalls: new Map(),
    pendingProgramCalls: new Set(),
  };
}

export function recordStreamEventForAbortReconciliation(
  state: StreamAbortReconciliationState,
  event: StreamEvent,
): void {
  if (event.type === 'response_done') {
    state.pendingFunctionCalls.clear();
    state.pendingProgramCalls.clear();
    state.responseId = event.response.id;
    return;
  }

  if (event.type !== 'model' || !isRecord(event.event)) {
    return;
  }

  const rawEvent = event.event;
  if (
    rawEvent.type === 'response.created' &&
    isRecord(rawEvent.response) &&
    typeof rawEvent.response.id === 'string'
  ) {
    state.responseId = rawEvent.response.id;
    return;
  }

  if (
    rawEvent.type !== 'response.output_item.done' ||
    !isRecord(rawEvent.item)
  ) {
    return;
  }

  const item = rawEvent.item;
  if (item.type === 'program' && typeof item.call_id === 'string') {
    state.pendingProgramCalls.add(item.call_id);
    return;
  }

  if (item.type === 'program_output' && typeof item.call_id === 'string') {
    state.pendingProgramCalls.delete(item.call_id);
    return;
  }

  if (item.type === 'function_call' && typeof item.call_id === 'string') {
    state.pendingFunctionCalls.set(item.call_id, {
      callId: item.call_id,
      name: typeof item.name === 'string' ? item.name : item.call_id,
      ...(typeof item.namespace === 'string'
        ? { namespace: item.namespace }
        : {}),
      ...(isRecord(item.caller) && item.caller.type === 'direct'
        ? { caller: { type: 'direct' as const } }
        : isRecord(item.caller) &&
            item.caller.type === 'program' &&
            typeof item.caller.caller_id === 'string'
          ? {
              caller: {
                type: 'program' as const,
                callerId: item.caller.caller_id,
              },
            }
          : {}),
    });
    return;
  }

  if (
    item.type === 'function_call_output' &&
    typeof item.call_id === 'string'
  ) {
    state.pendingFunctionCalls.delete(item.call_id);
  }
}

export function buildAbortReconciliationInput(
  state: StreamAbortReconciliationState,
): (FunctionCallResultItem | ProgramCallResultItem)[] {
  const functionOutputs = Array.from(
    state.pendingFunctionCalls.values(),
    (toolCall): FunctionCallResultItem => ({
      type: 'function_call_result',
      name: toolCall.name,
      ...(typeof toolCall.namespace === 'string'
        ? { namespace: toolCall.namespace }
        : {}),
      callId: toolCall.callId,
      status: 'incomplete',
      output: { type: 'text', text: 'aborted' },
      ...(toolCall.caller ? { caller: toolCall.caller } : {}),
    }),
  );
  const programOutputs = Array.from(
    state.pendingProgramCalls,
    (callId): ProgramCallResultItem => ({
      type: 'program_output',
      callId,
      status: 'incomplete',
      output: 'aborted',
    }),
  );

  return [...functionOutputs, ...programOutputs];
}

export function getAbortReconciliationPreviousResponseId(
  state: StreamAbortReconciliationState,
  request: Pick<ModelRequest, 'conversationId' | 'previousResponseId'>,
): string | undefined {
  if (request.conversationId) {
    return request.previousResponseId;
  }
  return state.responseId ?? request.previousResponseId;
}

export function shouldReconcileStreamAbort(
  state: StreamAbortReconciliationState,
): boolean {
  return (
    state.pendingFunctionCalls.size > 0 || state.pendingProgramCalls.size > 0
  );
}

export function markAbortReconciliationComplete(
  state: StreamAbortReconciliationState,
  response: ModelResponse | undefined,
): void {
  state.pendingFunctionCalls.clear();
  state.pendingProgramCalls.clear();
  if (response?.responseId) {
    state.responseId = response.responseId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
