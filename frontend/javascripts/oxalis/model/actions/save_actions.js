// @flow
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { getUid } from "libs/uid_generator";
import Date from "libs/date";
import Deferred from "libs/deferred";
import { type Dispatch } from "redux";

type Tracing = "skeleton" | "volume";

type PushSaveQueueTransaction = {
  type: "PUSH_SAVE_QUEUE_TRANSACTION",
  items: Array<UpdateAction>,
  tracingType: Tracing,
  transactionId: string,
};
type SaveNowAction = { type: "SAVE_NOW" };
type ShiftSaveQueueAction = {
  type: "SHIFT_SAVE_QUEUE",
  count: number,
  tracingType: Tracing,
};
type DiscardSaveQueuesAction = { type: "DISCARD_SAVE_QUEUES" };
type SetSaveBusyAction = { type: "SET_SAVE_BUSY", isBusy: boolean, tracingType: Tracing };
type SetLastSaveTimestampAction = {
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: number,
  tracingType: Tracing,
};
type SetVersionNumberAction = {
  type: "SET_VERSION_NUMBER",
  version: number,
  tracingType: Tracing,
};
export type UndoAction = { type: "UNDO", callback?: () => void };
export type RedoAction = { type: "REDO", callback?: () => void };
type DisableSavingAction = { type: "DISABLE_SAVING" };
export type SaveAction =
  | PushSaveQueueTransaction
  | SaveNowAction
  | ShiftSaveQueueAction
  | DiscardSaveQueuesAction
  | SetSaveBusyAction
  | SetLastSaveTimestampAction
  | SetVersionNumberAction
  | UndoAction
  | RedoAction
  | DisableSavingAction;

export const pushSaveQueueTransaction = (
  items: Array<UpdateAction>,
  tracingType: Tracing,
  transactionId: string = getUid(),
): PushSaveQueueTransaction => ({
  type: "PUSH_SAVE_QUEUE_TRANSACTION",
  items,
  tracingType,
  transactionId,
});

export const saveNowAction = (): SaveNowAction => ({
  type: "SAVE_NOW",
});

export const shiftSaveQueueAction = (
  count: number,
  tracingType: Tracing,
): ShiftSaveQueueAction => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
  tracingType,
});

export const discardSaveQueuesAction = (): DiscardSaveQueuesAction => ({
  type: "DISCARD_SAVE_QUEUES",
});

export const setSaveBusyAction = (isBusy: boolean, tracingType: Tracing): SetSaveBusyAction => ({
  type: "SET_SAVE_BUSY",
  isBusy,
  tracingType,
});

export const setLastSaveTimestampAction = (tracingType: Tracing): SetLastSaveTimestampAction => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: Date.now(),
  tracingType,
});

export const setVersionNumberAction = (
  version: number,
  tracingType: Tracing,
): SetVersionNumberAction => ({
  type: "SET_VERSION_NUMBER",
  version,
  tracingType,
});

export const undoAction = (callback?: () => void): UndoAction => ({
  type: "UNDO",
  callback,
});

export const redoAction = (callback?: () => void): RedoAction => ({
  type: "REDO",
  callback,
});

export const disableSavingAction = (): DisableSavingAction => ({
  type: "DISABLE_SAVING",
});

export const dispatchUndoAsync = async (dispatch: Dispatch<*>): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = undoAction(() => readyDeferred.resolve());
  dispatch(action);
  await readyDeferred.promise();
};

export const dispatchRedoAsync = async (dispatch: Dispatch<*>): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = redoAction(() => readyDeferred.resolve());
  dispatch(action);
  await readyDeferred.promise();
};
