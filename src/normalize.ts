import type {
  KaitenBoard,
  KaitenCard,
  KaitenChecklistSummary,
  KaitenComment,
  KaitenFile,
  KaitenTimeLog,
  KaitenUser,
} from "./types.js";

export function normalizeUser(user: KaitenUser | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    full_name: user.full_name ?? null,
    username: user.username ?? null,
  };
}

export function cardKey(card: KaitenCard): string | null {
  return (
    card.key ??
    card.aliases?.find((alias) => alias.actual)?.key ??
    card.aliases?.find((alias) => alias.key)?.key ??
    null
  );
}

export function normalizeCardSummary(card: KaitenCard) {
  return {
    id: card.id,
    key: cardKey(card),
    title: card.title,
    description: card.description ?? null,
    updated: card.updated ?? null,
    board_id: card.board_id,
    board: card.board?.title ?? null,
    column_id: card.column_id,
    column: card.column?.title ?? null,
    lane_id: card.lane_id ?? null,
    lane: card.lane?.title ?? null,
    state: card.state ?? null,
    condition: card.condition ?? null,
    version: card.version ?? null,
    blocked: card.blocked ?? false,
    owner: normalizeUser(card.owner),
    owner_id: card.owner_id ?? null,
    due_date: card.due_date ?? null,
    due_date_time_present: card.due_date_time_present ?? false,
    asap: card.asap ?? false,
    size_text: card.size_text ?? null,
    estimate_workload: card.estimate_workload ?? null,
    comments_total: card.comments_total ?? 0,
    children_count: card.children_count ?? 0,
    tags: (card.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
  };
}

export function normalizeBoard(board: KaitenBoard) {
  return {
    id: board.id,
    title: board.title,
    columns: (board.columns ?? []).map((column) => ({
      id: column.id,
      title: column.title,
      type: column.type,
      parent_column_id: column.column_id ?? null,
    })),
    lanes: (board.lanes ?? []).map((lane) => ({
      id: lane.id,
      title: lane.title,
    })),
  };
}

export function normalizeComment(comment: KaitenComment) {
  return {
    id: comment.id,
    created: comment.created ?? null,
    updated: comment.updated ?? null,
    text: comment.text,
    edited: comment.edited ?? false,
    deleted: comment.deleted ?? false,
    internal: comment.internal ?? false,
    author: normalizeUser(comment.author),
  };
}

export function normalizeTimeLogDate(value: string): string {
  return value.slice(0, 10);
}

export function normalizeTimeLog(timeLog: KaitenTimeLog) {
  return {
    id: timeLog.id,
    card_id: timeLog.card_id,
    user_id: timeLog.user_id ?? null,
    role_id: timeLog.role_id,
    role_name: timeLog.role?.name ?? null,
    author_id: timeLog.author_id ?? null,
    updater_id: timeLog.updater_id ?? null,
    time_spent: timeLog.time_spent,
    for_date: normalizeTimeLogDate(timeLog.for_date),
    comment: timeLog.comment ?? null,
    created: timeLog.created ?? null,
    updated: timeLog.updated ?? null,
    user: normalizeUser(timeLog.user),
    author: normalizeUser(timeLog.author),
  };
}

export function normalizeChecklist(checklist: KaitenChecklistSummary) {
  return {
    id: checklist.id,
    name: checklist.name,
    checked_items: checklist.checked_items ?? null,
    total_items: checklist.total_items ?? null,
    items: (checklist.items ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
      due_date: item.due_date ?? null,
      responsible_id: item.responsible_id ?? null,
    })),
  };
}

export function normalizeFile(file: KaitenFile) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    mime_type: file.mime_type ?? null,
    comment_id: file.comment_id ?? null,
    url: file.url,
  };
}
