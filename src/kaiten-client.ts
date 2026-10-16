import type { KaitenConfig } from "./config.js";
import { webBaseUrl } from "./config.js";
import {
  documentReferenceFromUrl,
  documentUrlFromProperty,
  isDocumentUid,
} from "./document.js";
import { cardKey } from "./normalize.js";
import type {
  AttachmentContent,
  CardSearchResponse,
  KaitenBoard,
  KaitenCard,
  KaitenChecklistSummary,
  KaitenComment,
  KaitenCustomProperty,
  KaitenCustomPropertyValue,
  KaitenDocument,
  KaitenFile,
  KaitenCardBlocker,
  KaitenChecklistItem,
  KaitenTag,
  KaitenTimeLog,
  KaitenUser,
} from "./types.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIME_LOG_ROLE_ID = -1;

type FetchImplementation = typeof fetch;

export interface SearchCardsInput {
  spaceId?: number;
  query?: string;
  boardId?: number;
  columnId?: number;
  laneId?: number;
  ownerId?: number;
  states?: number[];
  limit?: number;
  cursor?: string;
  ignoreDefaultOwner?: boolean;
}

export interface UpdateCardInput {
  card: string | number;
  spaceId?: number;
  expectedVersion: number;
  title?: string;
  description?: string | null;
  ownerId?: number;
  dueDate?: string | null;
  dueDateTimePresent?: boolean;
  asap?: boolean;
  sizeText?: string | null;
  estimateWorkload?: number;
  customProperties?: Array<{
    id: number;
    expectedName: string;
    value: KaitenCustomPropertyValue;
  }>;
}

export interface ListCustomPropertiesInput {
  query?: string;
  limit?: number;
}

export interface ReadLinkedDocumentInput {
  card: string | number;
  spaceId?: number;
  propertyName: string;
}

export interface AddTimeLogInput {
  card: string | number;
  spaceId?: number;
  timeSpent: number;
  forDate: string;
  roleId?: number;
  comment?: string;
}

export interface ListCardTimeLogsInput {
  card: string | number;
  spaceId?: number;
  forDate?: string;
  personal?: boolean;
  limit?: number;
  offset?: number;
}

export interface UpdateTimeLogInput {
  card: string | number;
  spaceId?: number;
  timeLogId: number;
  timeSpent?: number;
  forDate?: string;
  roleId?: number;
  comment?: string;
}

export interface RemoveTimeLogInput {
  card: string | number;
  spaceId?: number;
  timeLogId: number;
}

export interface CreateCardInput {
  title: string;
  boardId: number;
  columnId: number;
  spaceId?: number;
  laneId?: number;
  ownerId?: number;
  description?: string;
  typeId?: number;
  position?: 1 | 2;
  asap?: boolean;
  dueDate?: string;
}

export interface ArchiveCardInput {
  card: string | number;
  spaceId?: number;
  expectedVersion: number;
}

export interface AddChecklistInput {
  card: string | number;
  spaceId?: number;
  name: string;
}

export interface AddChecklistItemInput {
  card: string | number;
  spaceId?: number;
  checklistId: number;
  text: string;
  checked?: boolean;
  dueDate?: string | null;
  responsibleId?: number | null;
}

export interface UpdateChecklistItemInput {
  card: string | number;
  spaceId?: number;
  checklistId: number;
  itemId: number;
  text?: string;
  checked?: boolean;
}

export interface RemoveChecklistItemInput {
  card: string | number;
  spaceId?: number;
  checklistId: number;
  itemId: number;
}

export interface ListTagsInput {
  spaceId?: number;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface AddCardTagInput {
  card: string | number;
  spaceId?: number;
  name: string;
}

export interface RemoveCardTagInput {
  card: string | number;
  spaceId?: number;
  tagId: number;
}

export interface AddCardMemberInput {
  card: string | number;
  spaceId?: number;
  userId: number;
}

export interface RemoveCardMemberInput {
  card: string | number;
  spaceId?: number;
  userId: number;
}

export interface ListCardBlockersInput {
  card: string | number;
  spaceId?: number;
}

export interface AddCardBlockerInput {
  card: string | number;
  spaceId?: number;
  reason?: string;
  blockerCardId?: number;
}

export interface UpdateCardBlockerInput {
  card: string | number;
  spaceId?: number;
  blockerId: number;
  reason?: string | null;
  blockerCardId?: number | null;
}

export interface RemoveCardBlockerInput {
  card: string | number;
  spaceId?: number;
  blockerId: number;
}

export interface AddCardChildInput {
  card: string | number;
  spaceId?: number;
  childCardId: number;
}

export interface RemoveCardChildInput {
  card: string | number;
  spaceId?: number;
  childCardId: number;
}

export interface ListTimesheetInput {
  from: string;
  to: string;
  spaceId?: number;
  userIds?: number[];
  spaceIds?: number[];
  boardIds?: number[];
  cardIds?: number[];
  limit?: number;
  offset?: number;
  personal?: boolean;
}

export class KaitenApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "KaitenApiError";
  }
}

function cookiePairs(headers: Headers): string[] {
  const values = headers.getSetCookie?.() ?? [];
  const fallbacks = values.length > 0 ? values : [headers.get("set-cookie") ?? ""];
  return fallbacks
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);
}

function safeBodyPreview(value: string): string {
  return value.length <= 1_000 ? value : `${value.slice(0, 1_000)}…`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class KaitenClient {
  private cookieHeader = "";
  private readonly boardsBySpaceCache = new Map<number, KaitenBoard[]>();

  constructor(
    readonly config: KaitenConfig,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  private apiUrl(
    path: string,
    query?: URLSearchParams,
    version: "configured" | "latest" = "configured",
  ): URL {
    const configured = new URL(this.config.apiBaseUrl);
    if (version === "latest") {
      configured.pathname = configured.pathname.replace(
        /\/api\/(?:v\d+|latest)\/?$/,
        "/api/latest",
      );
    }
    const base = configured.toString().replace(/\/+$/, "");
    const url = new URL(`${base}/${path.replace(/^\/+/, "")}`);
    if (query) url.search = query.toString();
    return url;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    query?: URLSearchParams,
    version: "configured" | "latest" = "configured",
  ): Promise<T> {
    let url = this.apiUrl(path, query, version);
    let rateLimitRetries = 0;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("Authorization", `Bearer ${this.config.token}`);
      headers.set("X-Kaiten-Client", "kaiten-mcp");
      headers.set("X-Kaiten-Client-Version", "0.1.0");
      headers.set(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KaitenMCP/0.1.0",
      );
      if (this.cookieHeader) headers.set("Cookie", this.cookieHeader);
      if (init.body !== undefined) headers.set("Content-Type", "application/json");

      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        redirect: "manual",
      });

      const newCookies = cookiePairs(response.headers);
      if (newCookies.length > 0) {
        this.cookieHeader = newCookies.join("; ");
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new KaitenApiError("Kaiten redirect has no Location header");
        }

        const nextUrl = new URL(location, url);
        if (nextUrl.origin !== this.config.apiBaseUrl.origin) {
          throw new KaitenApiError(
            `Kaiten tried to redirect API credentials to ${nextUrl.origin}`,
          );
        }
        url = nextUrl;
        continue;
      }

      if (response.status === 429 && rateLimitRetries < 3) {
        rateLimitRetries += 1;
        const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
        const resetDelay = Number.isFinite(resetSeconds)
          ? Math.max(0, resetSeconds * 1_000 - Date.now())
          : 250 * 2 ** rateLimitRetries;
        await delay(Math.min(resetDelay, 2_000));
        continue;
      }

      const text = await response.text();
      if (!response.ok) {
        throw new KaitenApiError(
          `Kaiten API returned HTTP ${response.status}`,
          response.status,
          safeBodyPreview(text),
        );
      }

      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new KaitenApiError(
          "Kaiten API returned invalid JSON",
          response.status,
          safeBodyPreview(text),
        );
      }
    }

    throw new KaitenApiError("Too many Kaiten redirects or retries");
  }

  async currentUser(): Promise<KaitenUser> {
    return this.request<KaitenUser>("users/current");
  }

  async assertExpectedActor(): Promise<KaitenUser> {
    const actor = await this.currentUser();
    if (
      this.config.expectedActorId !== undefined &&
      actor.id !== this.config.expectedActorId
    ) {
      throw new Error(
        `Kaiten token belongs to user ${actor.id}, expected ${this.config.expectedActorId}`,
      );
    }
    return actor;
  }

  selectSpaceId(requestedSpaceId?: number): number | undefined {
    if (requestedSpaceId !== undefined) {
      this.assertSpaceAllowed(requestedSpaceId);
      return requestedSpaceId;
    }
    if (this.config.defaultSpaceId !== undefined) {
      return this.config.defaultSpaceId;
    }
    if (this.config.allowedSpaceIds.size === 1) {
      return this.config.allowedSpaceIds.values().next().value;
    }
    return undefined;
  }

  assertSpaceAllowed(spaceId: number): void {
    if (
      this.config.allowedSpaceIds.size > 0 &&
      !this.config.allowedSpaceIds.has(spaceId)
    ) {
      throw new Error(`Space ${spaceId} is outside the configured boundary`);
    }
  }

  private requireSpaceId(requestedSpaceId?: number): number {
    const spaceId = this.selectSpaceId(requestedSpaceId);
    if (spaceId === undefined) {
      throw new Error(
        "space_id is required because no default Kaiten space is configured",
      );
    }
    return spaceId;
  }

  async getSpace(requestedSpaceId?: number): Promise<{
    id: number;
    title: string;
  }> {
    const spaceId = this.requireSpaceId(requestedSpaceId);
    return this.request(`spaces/${spaceId}`);
  }

  async listSpaces(): Promise<Array<{ id: number; title: string }>> {
    const spaces = await this.request<Array<{ id: number; title: string }>>(
      "spaces",
    );
    return this.config.allowedSpaceIds.size === 0
      ? spaces
      : spaces.filter((space) => this.config.allowedSpaceIds.has(space.id));
  }

  async listBoards(requestedSpaceId?: number): Promise<KaitenBoard[]> {
    const spaceId = this.requireSpaceId(requestedSpaceId);
    const cached = this.boardsBySpaceCache.get(spaceId);
    if (cached) {
      return cached;
    }
    const boards = await this.request<KaitenBoard[]>(`spaces/${spaceId}/boards`);
    this.boardsBySpaceCache.set(spaceId, boards);
    return boards;
  }

  async searchCards(input: SearchCardsInput = {}): Promise<CardSearchResponse> {
    const params = new URLSearchParams({
      version: "2",
      broken_api: "false",
      limit: String(Math.min(Math.max(input.limit ?? 25, 1), 100)),
      additional_card_fields: "description",
    });

    const spaceId = this.selectSpaceId(input.spaceId);
    if (spaceId !== undefined) {
      params.set("space_id", String(spaceId));
    }
    if (input.query) params.set("query", input.query);
    if (input.boardId !== undefined) params.set("board_id", String(input.boardId));
    if (input.columnId !== undefined)
      params.set("column_id", String(input.columnId));
    if (input.laneId !== undefined) params.set("lane_id", String(input.laneId));
    if (input.states?.length) params.set("states", input.states.join(","));
    if (input.cursor) params.set("start_position", input.cursor);

    const ownerId =
      input.ownerId ??
      (input.ignoreDefaultOwner ? undefined : this.config.defaultOwnerId);
    if (ownerId !== undefined) params.set("owner_id", String(ownerId));

    return this.request<CardSearchResponse>("cards", {}, params);
  }

  async getCard(cardId: number): Promise<KaitenCard> {
    const params = new URLSearchParams({ broken_api: "false" });
    return this.request<KaitenCard>(`cards/${cardId}`, {}, params);
  }

  async resolveCard(
    reference: string | number,
    spaceId?: number,
  ): Promise<KaitenCard> {
    if (typeof reference === "number" || /^\d+$/.test(reference.trim())) {
      const card = await this.getCard(Number(reference));
      await this.spaceIdForCard(card, spaceId);
      return card;
    }

    const normalizedReference = reference.trim().toLowerCase();
    const response = await this.searchCards({
      ...(spaceId === undefined ? {} : { spaceId }),
      query: reference.trim(),
      limit: 25,
      ignoreDefaultOwner: true,
    });
    const exact = response.result.filter(
      (card) => cardKey(card)?.toLowerCase() === normalizedReference,
    );
    if (exact.length === 1) {
      const card = await this.getCard(exact[0]!.id);
      await this.spaceIdForCard(card, spaceId);
      return card;
    }
    if (exact.length > 1) {
      throw new Error(`Card key ${reference} is ambiguous`);
    }
    if (response.result.length === 1) {
      const card = await this.getCard(response.result[0]!.id);
      await this.spaceIdForCard(card, spaceId);
      return card;
    }
    if (response.result.length === 0) throw new Error(`Card ${reference} not found`);
    throw new Error(
      `Card reference ${reference} matched ${response.result.length} cards; use a card key or numeric id`,
    );
  }

  async getComments(cardId: number): Promise<KaitenComment[]> {
    return this.request<KaitenComment[]>(`cards/${cardId}/comments`);
  }

  async getChecklist(
    cardId: number,
    checklistId: number,
  ): Promise<KaitenChecklistSummary> {
    return this.request<KaitenChecklistSummary>(
      `cards/${cardId}/checklists/${checklistId}`,
    );
  }

  async getChildren(cardId: number): Promise<KaitenCard[]> {
    return this.request<KaitenCard[]>(`cards/${cardId}/children`);
  }

  async listCustomProperties(
    input: ListCustomPropertiesInput = {},
  ): Promise<KaitenCustomProperty[]> {
    const params = new URLSearchParams({
      compact: "false",
      limit: String(Math.min(Math.max(input.limit ?? 100, 1), 100)),
    });
    if (input.query) params.set("query", input.query);
    return this.request<KaitenCustomProperty[]>(
      "company/custom-properties",
      {},
      params,
    );
  }

  async getCustomProperty(propertyId: number): Promise<KaitenCustomProperty> {
    return this.request<KaitenCustomProperty>(
      `company/custom-properties/${propertyId}`,
    );
  }

  async listDocuments(query: string): Promise<KaitenDocument[]> {
    const params = new URLSearchParams({ query, limit: "100" });
    return this.request<KaitenDocument[]>(
      "documents",
      {},
      params,
      "latest",
    );
  }

  async getDocument(documentUid: string): Promise<KaitenDocument> {
    return this.request<KaitenDocument>(
      `documents/${encodeURIComponent(documentUid)}`,
      {},
      undefined,
      "latest",
    );
  }

  private async resolveDocument(reference: string): Promise<KaitenDocument> {
    if (isDocumentUid(reference)) return this.getDocument(reference);

    const normalized = reference.toLowerCase();
    const exact = (await this.listDocuments(reference)).filter(
      (document) =>
        document.uid.toLowerCase() === normalized ||
        document.key?.toLowerCase() === normalized,
    );
    if (exact.length === 0) {
      throw new Error(`Kaiten document ${reference} not found`);
    }
    if (exact.length > 1) {
      throw new Error(`Kaiten document reference ${reference} is ambiguous`);
    }
    return this.getDocument(exact[0]!.uid);
  }

  async readLinkedDocument(input: ReadLinkedDocumentInput): Promise<{
    card: KaitenCard;
    property: KaitenCustomProperty;
    propertyUrl: string;
    document: KaitenDocument;
  }> {
    const card = await this.resolveCard(input.card, input.spaceId);
    const definitions = (await this.listCustomProperties({
      query: input.propertyName,
      limit: 100,
    })).filter(
      (property) =>
        property.name === input.propertyName &&
        (property.condition === undefined || property.condition === "active"),
    );
    if (definitions.length === 0) {
      throw new Error(`Active custom property ${input.propertyName} not found`);
    }
    if (definitions.length > 1) {
      throw new Error(`Custom property ${input.propertyName} is ambiguous`);
    }

    const property = definitions[0]!;
    if (property.type !== "url") {
      throw new Error(
        `Custom property ${input.propertyName} has type ${property.type}, expected url`,
      );
    }
    const propertyUrl = documentUrlFromProperty(
      card.properties?.[`id_${property.id}`],
    );
    const documentReference = documentReferenceFromUrl(
      propertyUrl,
      webBaseUrl(this.config).origin,
    );
    const document = await this.resolveDocument(documentReference);
    return { card, property, propertyUrl, document };
  }

  async getCardContext(
    reference: string | number,
    includeChildren = true,
    spaceId?: number,
  ) {
    const card = await this.resolveCard(reference, spaceId);
    const checklistSummaries = card.checklists ?? [];
    const [comments, checklists, children] = await Promise.all([
      this.getComments(card.id),
      Promise.all(
        checklistSummaries.map((checklist) =>
          this.getChecklist(card.id, checklist.id),
        ),
      ),
      includeChildren ? this.getChildren(card.id) : Promise.resolve([]),
    ]);
    return { card, comments, checklists, children, files: card.files ?? [] };
  }

  private async boundarySpaceIds(): Promise<number[]> {
    if (this.config.allowedSpaceIds.size > 0) {
      return [...this.config.allowedSpaceIds];
    }
    return (await this.listSpaces()).map((space) => space.id);
  }

  private async allowedBoards(spaceId: number): Promise<KaitenBoard[]> {
    const boards = await this.listBoards(spaceId);
    return this.config.allowedBoardIds.size === 0
      ? boards
      : boards.filter((board) => this.config.allowedBoardIds.has(board.id));
  }

  async spaceIdForCard(
    card: KaitenCard,
    requestedSpaceId?: number,
  ): Promise<number> {
    const spaceIds =
      requestedSpaceId === undefined
        ? await this.boundarySpaceIds()
        : [this.requireSpaceId(requestedSpaceId)];
    for (const spaceId of spaceIds) {
      const boards = await this.allowedBoards(spaceId);
      if (boards.some((board) => board.id === card.board_id)) {
        return spaceId;
      }
    }
    throw new Error(`Card board ${card.board_id} is outside the configured boundary`);
  }

  async moveCard(input: {
    card: string | number;
    spaceId?: number;
    expectedColumnId: number;
    targetColumnId: number;
    targetLaneId?: number;
  }): Promise<KaitenCard> {
    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    const sourceSpaceId = await this.spaceIdForCard(card, input.spaceId);
    if (card.column_id !== input.expectedColumnId) {
      throw new Error(
        `Card is in column ${card.column_id}, expected ${input.expectedColumnId}; refusing stale move`,
      );
    }

    const boards = await this.allowedBoards(sourceSpaceId);
    const targetBoard = boards.find((board) =>
      board.columns?.some((column) => column.id === input.targetColumnId),
    );
    if (!targetBoard) {
      throw new Error(
        `Target column ${input.targetColumnId} is outside the configured boundary`,
      );
    }
    if (
      input.targetLaneId !== undefined &&
      !targetBoard.lanes?.some((lane) => lane.id === input.targetLaneId)
    ) {
      throw new Error(
        `Target lane ${input.targetLaneId} does not belong to board ${targetBoard.id}`,
      );
    }

    const patch: Record<string, number> = {
      column_id: input.targetColumnId,
    };
    if (targetBoard.id !== card.board_id) patch.board_id = targetBoard.id;
    if (input.targetLaneId !== undefined) patch.lane_id = input.targetLaneId;

    return this.request<KaitenCard>(`cards/${card.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async updateCard(input: UpdateCardInput): Promise<KaitenCard> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.dueDateTimePresent !== undefined) {
      patch.due_date_time_present = input.dueDateTimePresent;
    }
    if (input.asap !== undefined) patch.asap = input.asap;
    if (input.sizeText !== undefined) patch.size_text = input.sizeText;
    if (input.estimateWorkload !== undefined) {
      patch.estimate_workload = input.estimateWorkload;
    }
    if (input.customProperties !== undefined) {
      if (input.customProperties.length === 0) {
        throw new Error("customProperties must contain at least one property");
      }
      const ids = input.customProperties.map((property) => property.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("customProperties contains duplicate property ids");
      }
      for (const property of input.customProperties) {
        if (!Number.isSafeInteger(property.id) || property.id <= 0) {
          throw new Error("Custom property id must be a positive integer");
        }
        if (!property.expectedName.trim()) {
          throw new Error("Custom property expectedName is required");
        }
      }
    }
    if (
      Object.keys(patch).length === 0 &&
      input.customProperties === undefined
    ) {
      throw new Error("At least one card field must be provided for update");
    }

    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    if (card.version === undefined) {
      throw new Error("Kaiten did not return the card version; refusing unsafe update");
    }
    if (card.version !== input.expectedVersion) {
      throw new Error(
        `Card version is ${card.version}, expected ${input.expectedVersion}; refusing stale update`,
      );
    }

    if (input.customProperties !== undefined) {
      const definitions = await Promise.all(
        input.customProperties.map((property) =>
          this.getCustomProperty(property.id),
        ),
      );
      const properties: Record<string, KaitenCustomPropertyValue> = {};
      for (const [index, definition] of definitions.entries()) {
        const requested = input.customProperties[index]!;
        if (definition.name !== requested.expectedName) {
          throw new Error(
            `Custom property ${requested.id} is named ${JSON.stringify(definition.name)}, expected ${JSON.stringify(requested.expectedName)}; refusing update`,
          );
        }
        if (definition.condition !== undefined && definition.condition !== "active") {
          throw new Error(
            `Custom property ${requested.id} is ${definition.condition}; refusing update`,
          );
        }
        properties[`id_${requested.id}`] = requested.value;
      }
      patch.properties = properties;
    }

    return this.request<KaitenCard>(`cards/${card.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async addComment(
    reference: string | number,
    text: string,
    spaceId?: number,
  ): Promise<KaitenComment> {
    await this.assertExpectedActor();
    const card = await this.resolveCard(reference, spaceId);
    return this.request<KaitenComment>(`cards/${card.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  private assertTimeLogDate(forDate: string): string {
    const normalized = forDate.trim();
    if (!DATE_ONLY_PATTERN.test(normalized)) {
      throw new Error("for_date must use YYYY-MM-DD");
    }
    return normalized;
  }

  async addTimeLog(input: AddTimeLogInput): Promise<KaitenTimeLog> {
    if (!Number.isSafeInteger(input.timeSpent) || input.timeSpent < 1) {
      throw new Error("time_spent must be an integer number of minutes >= 1");
    }
    const forDate = this.assertTimeLogDate(input.forDate);
    const roleId = input.roleId ?? DEFAULT_TIME_LOG_ROLE_ID;
    if (!Number.isSafeInteger(roleId)) {
      throw new Error("role_id must be an integer");
    }
    if (input.comment !== undefined && input.comment.length > 4_096) {
      throw new Error("comment must be at most 4096 characters");
    }

    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    const body: Record<string, unknown> = {
      role_id: roleId,
      time_spent: input.timeSpent,
      for_date: forDate,
    };
    if (input.comment !== undefined) body.comment = input.comment;

    return this.request<KaitenTimeLog>(`cards/${card.id}/time-logs`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async listCardTimeLogs(
    input: ListCardTimeLogsInput,
  ): Promise<KaitenTimeLog[]> {
    const card = await this.resolveCard(input.card, input.spaceId);
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(input.limit ?? 100, 1), 100)),
      offset: String(Math.max(input.offset ?? 0, 0)),
    });
    if (input.forDate !== undefined) {
      params.set("for_date", this.assertTimeLogDate(input.forDate));
    }
    if (input.personal !== undefined) {
      params.set("personal", String(input.personal));
    }
    return this.request<KaitenTimeLog[]>(
      `cards/${card.id}/time-logs`,
      {},
      params,
    );
  }

  async updateTimeLog(input: UpdateTimeLogInput): Promise<KaitenTimeLog> {
    if (!Number.isSafeInteger(input.timeLogId) || input.timeLogId <= 0) {
      throw new Error("time_log_id must be a positive integer");
    }
    const patch: Record<string, unknown> = {};
    if (input.timeSpent !== undefined) {
      if (!Number.isSafeInteger(input.timeSpent) || input.timeSpent < 1) {
        throw new Error("time_spent must be an integer number of minutes >= 1");
      }
      patch.time_spent = input.timeSpent;
    }
    if (input.forDate !== undefined) {
      patch.for_date = this.assertTimeLogDate(input.forDate);
    }
    if (input.roleId !== undefined) {
      if (!Number.isSafeInteger(input.roleId)) {
        throw new Error("role_id must be an integer");
      }
      patch.role_id = input.roleId;
    }
    if (input.comment !== undefined) {
      if (input.comment.length > 4_096) {
        throw new Error("comment must be at most 4096 characters");
      }
      patch.comment = input.comment;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("At least one time log field must be provided for update");
    }

    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    return this.request<KaitenTimeLog>(
      `cards/${card.id}/time-logs/${input.timeLogId}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    );
  }

  private async assertBoardColumnAllowed(
    spaceId: number,
    boardId: number,
    columnId: number,
    laneId?: number,
  ): Promise<void> {
    const boards = await this.allowedBoards(spaceId);
    const board = boards.find((candidate) => candidate.id === boardId);
    if (!board) {
      throw new Error(`Board ${boardId} is outside the configured boundary`);
    }
    if (!board.columns?.some((column) => column.id === columnId)) {
      throw new Error(
        `Column ${columnId} does not belong to board ${boardId} in the configured boundary`,
      );
    }
    if (
      laneId !== undefined &&
      !board.lanes?.some((lane) => lane.id === laneId)
    ) {
      throw new Error(
        `Lane ${laneId} does not belong to board ${boardId} in the configured boundary`,
      );
    }
  }

  private async assertCardInBoundary(
    reference: string | number,
    spaceId?: number,
  ): Promise<KaitenCard> {
    const card = await this.resolveCard(reference, spaceId);
    await this.spaceIdForCard(card, spaceId);
    return card;
  }

  async createCard(input: CreateCardInput): Promise<KaitenCard> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("title is required");
    }
    if (!Number.isSafeInteger(input.boardId) || input.boardId <= 0) {
      throw new Error("board_id must be a positive integer");
    }
    if (!Number.isSafeInteger(input.columnId) || input.columnId <= 0) {
      throw new Error("column_id must be a positive integer");
    }
    if (input.position !== undefined && input.position !== 1 && input.position !== 2) {
      throw new Error("position must be 1 or 2");
    }

    await this.assertExpectedActor();
    const spaceId = this.requireSpaceId(input.spaceId);
    await this.assertBoardColumnAllowed(
      spaceId,
      input.boardId,
      input.columnId,
      input.laneId,
    );

    const body: Record<string, unknown> = {
      title,
      board_id: input.boardId,
      column_id: input.columnId,
    };
    if (input.laneId !== undefined) body.lane_id = input.laneId;
    if (input.ownerId !== undefined) body.owner_id = input.ownerId;
    if (input.description !== undefined) body.description = input.description;
    if (input.typeId !== undefined) body.type_id = input.typeId;
    if (input.position !== undefined) body.position = input.position;
    if (input.asap !== undefined) body.asap = input.asap;
    if (input.dueDate !== undefined) body.due_date = input.dueDate;

    return this.request<KaitenCard>("cards", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async archiveCard(input: ArchiveCardInput): Promise<KaitenCard> {
    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    await this.spaceIdForCard(card, input.spaceId);
    if (card.version === undefined) {
      throw new Error("Kaiten did not return the card version; refusing unsafe archive");
    }
    if (card.version !== input.expectedVersion) {
      throw new Error(
        `Card version is ${card.version}, expected ${input.expectedVersion}; refusing stale archive`,
      );
    }

    return this.request<KaitenCard>(`cards/${card.id}`, {
      method: "PATCH",
      body: JSON.stringify({ condition: 2 }),
    });
  }

  async addChecklist(input: AddChecklistInput): Promise<KaitenChecklistSummary> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("name is required");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenChecklistSummary>(`cards/${card.id}/checklists`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async addChecklistItem(
    input: AddChecklistItemInput,
  ): Promise<KaitenChecklistItem> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("text is required");
    }
    if (!Number.isSafeInteger(input.checklistId) || input.checklistId <= 0) {
      throw new Error("checklist_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    const body: Record<string, unknown> = { text };
    if (input.checked !== undefined) body.checked = input.checked;
    if (input.dueDate !== undefined) body.due_date = input.dueDate;
    if (input.responsibleId !== undefined) {
      body.responsible_id = input.responsibleId;
    }
    return this.request<KaitenChecklistItem>(
      `cards/${card.id}/checklists/${input.checklistId}/items`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async updateChecklistItem(
    input: UpdateChecklistItemInput,
  ): Promise<KaitenChecklistItem> {
    if (!Number.isSafeInteger(input.checklistId) || input.checklistId <= 0) {
      throw new Error("checklist_id must be a positive integer");
    }
    if (!Number.isSafeInteger(input.itemId) || input.itemId <= 0) {
      throw new Error("item_id must be a positive integer");
    }
    const patch: Record<string, unknown> = {};
    if (input.text !== undefined) {
      const text = input.text.trim();
      if (!text) {
        throw new Error("text must not be empty when provided");
      }
      patch.text = text;
    }
    if (input.checked !== undefined) patch.checked = input.checked;
    if (Object.keys(patch).length === 0) {
      throw new Error("At least one checklist item field must be provided for update");
    }

    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenChecklistItem>(
      `cards/${card.id}/checklists/${input.checklistId}/items/${input.itemId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
  }

  async removeChecklistItem(
    input: RemoveChecklistItemInput,
  ): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.checklistId) || input.checklistId <= 0) {
      throw new Error("checklist_id must be a positive integer");
    }
    if (!Number.isSafeInteger(input.itemId) || input.itemId <= 0) {
      throw new Error("item_id must be a positive integer");
    }

    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/checklists/${input.checklistId}/items/${input.itemId}`,
      { method: "DELETE" },
    );
  }

  async listTags(input: ListTagsInput = {}): Promise<KaitenTag[]> {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(input.limit ?? 100, 1), 100)),
      offset: String(Math.max(input.offset ?? 0, 0)),
    });
    const spaceId = this.selectSpaceId(input.spaceId);
    if (spaceId !== undefined) {
      params.set("space_id", String(spaceId));
    }
    if (input.query) params.set("query", input.query);
    return this.request<KaitenTag[]>("tags", {}, params);
  }

  async addCardTag(input: AddCardTagInput): Promise<KaitenTag> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("name is required");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenTag>(`cards/${card.id}/tags`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async removeCardTag(input: RemoveCardTagInput): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.tagId) || input.tagId <= 0) {
      throw new Error("tag_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/tags/${input.tagId}`,
      { method: "DELETE" },
    );
  }

  async addCardMember(input: AddCardMemberInput): Promise<KaitenUser> {
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
      throw new Error("user_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenUser>(`cards/${card.id}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: input.userId }),
    });
  }

  async removeCardMember(
    input: RemoveCardMemberInput,
  ): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
      throw new Error("user_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/members/${input.userId}`,
      { method: "DELETE" },
    );
  }

  async listCardBlockers(
    input: ListCardBlockersInput,
  ): Promise<KaitenCardBlocker[]> {
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenCardBlocker[]>(`cards/${card.id}/blockers`);
  }

  async addCardBlocker(input: AddCardBlockerInput): Promise<KaitenCardBlocker> {
    const hasReason =
      input.reason !== undefined && input.reason.trim().length > 0;
    const hasBlockerCard =
      input.blockerCardId !== undefined &&
      Number.isSafeInteger(input.blockerCardId) &&
      input.blockerCardId > 0;
    if (!hasReason && !hasBlockerCard) {
      throw new Error("Provide reason and/or blocker_card_id");
    }

    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    const body: Record<string, unknown> = {};
    if (hasReason) body.reason = input.reason!.trim();
    if (hasBlockerCard) {
      const blockerCard = await this.getCard(input.blockerCardId!);
      await this.spaceIdForCard(blockerCard, input.spaceId);
      body.blocker_card_id = input.blockerCardId;
    }

    return this.request<KaitenCardBlocker>(`cards/${card.id}/blockers`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateCardBlocker(
    input: UpdateCardBlockerInput,
  ): Promise<KaitenCardBlocker> {
    if (!Number.isSafeInteger(input.blockerId) || input.blockerId <= 0) {
      throw new Error("blocker_id must be a positive integer");
    }
    const patch: Record<string, unknown> = {};
    if (input.reason !== undefined) patch.reason = input.reason;
    if (input.blockerCardId !== undefined) {
      if (input.blockerCardId !== null) {
        const blockerCard = await this.getCard(input.blockerCardId);
        await this.spaceIdForCard(blockerCard, input.spaceId);
      }
      patch.blocker_card_id = input.blockerCardId;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("At least one blocker field must be provided for update");
    }

    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<KaitenCardBlocker>(
      `cards/${card.id}/blockers/${input.blockerId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
  }

  async removeCardBlocker(
    input: RemoveCardBlockerInput,
  ): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.blockerId) || input.blockerId <= 0) {
      throw new Error("blocker_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/blockers/${input.blockerId}`,
      { method: "DELETE" },
    );
  }

  async addCardChild(input: AddCardChildInput): Promise<KaitenCard> {
    if (!Number.isSafeInteger(input.childCardId) || input.childCardId <= 0) {
      throw new Error("card_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const parent = await this.assertCardInBoundary(input.card, input.spaceId);
    const child = await this.getCard(input.childCardId);
    await this.spaceIdForCard(child, input.spaceId);
    return this.request<KaitenCard>(`cards/${parent.id}/children`, {
      method: "POST",
      body: JSON.stringify({ card_id: input.childCardId }),
    });
  }

  async removeCardChild(input: RemoveCardChildInput): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.childCardId) || input.childCardId <= 0) {
      throw new Error("card_id must be a positive integer");
    }
    await this.assertExpectedActor();
    const card = await this.assertCardInBoundary(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/children/${input.childCardId}`,
      { method: "DELETE" },
    );
  }

  async listTimesheet(input: ListTimesheetInput): Promise<KaitenTimeLog[]> {
    const from = this.assertTimeLogDate(input.from);
    const to = this.assertTimeLogDate(input.to);
    const params = new URLSearchParams({
      from,
      to,
      limit: String(Math.min(Math.max(input.limit ?? 100, 1), 100)),
      offset: String(Math.max(input.offset ?? 0, 0)),
    });

    const personal = input.personal ?? true;
    if (personal) {
      const actor = await this.currentUser();
      params.set("user_ids", String(actor.id));
    } else if (input.userIds?.length) {
      params.set("user_ids", input.userIds.join(","));
    }

    const spaceId = this.selectSpaceId(input.spaceId);
    if (spaceId !== undefined) {
      params.set("space_ids", String(spaceId));
    } else if (input.spaceIds?.length) {
      for (const id of input.spaceIds) {
        this.assertSpaceAllowed(id);
      }
      params.set("space_ids", input.spaceIds.join(","));
    }

    if (input.boardIds?.length) {
      params.set("board_ids", input.boardIds.join(","));
    }
    if (input.cardIds?.length) {
      params.set("card_ids", input.cardIds.join(","));
    }

    return this.request<KaitenTimeLog[]>("time-logs", {}, params);
  }

  async removeTimeLog(
    input: RemoveTimeLogInput,
  ): Promise<{ id: number }> {
    if (!Number.isSafeInteger(input.timeLogId) || input.timeLogId <= 0) {
      throw new Error("time_log_id must be a positive integer");
    }

    await this.assertExpectedActor();
    const card = await this.resolveCard(input.card, input.spaceId);
    return this.request<{ id: number }>(
      `cards/${card.id}/time-logs/${input.timeLogId}`,
      { method: "DELETE" },
    );
  }

  async readAttachment(
    reference: string | number,
    fileId: number,
    spaceId?: number,
  ): Promise<AttachmentContent> {
    const card = await this.resolveCard(reference, spaceId);
    const file = (card.files ?? []).find(
      (candidate) => candidate.id === fileId && !candidate.deleted,
    );
    if (!file) throw new Error(`Attachment ${fileId} not found on card ${card.id}`);
    if (file.type === 11) {
      throw new Error("Restricted Kaiten files are not supported in this MVP");
    }
    if (file.size > this.config.maxAttachmentBytes) {
      throw new Error(
        `Attachment is ${file.size} bytes; limit is ${this.config.maxAttachmentBytes}`,
      );
    }

    let url = new URL(file.url);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      if (!this.config.allowedFileHosts.has(url.hostname.toLowerCase())) {
        throw new Error(`Attachment host ${url.hostname} is not allow-listed`);
      }
      const response = await this.fetchImpl(url, {
        redirect: "manual",
        headers: {
          Accept: "*/*",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KaitenMCP/0.1.0",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Attachment redirect has no Location header");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Attachment download returned HTTP ${response.status}`);
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > this.config.maxAttachmentBytes
      ) {
        throw new Error(`Attachment exceeds the configured size limit`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.config.maxAttachmentBytes) {
        throw new Error(`Attachment exceeds the configured size limit`);
      }
      return {
        file,
        contentType:
          response.headers.get("content-type")?.split(";", 1)[0] ??
          file.mime_type ??
          "application/octet-stream",
        bytes,
      };
    }

    throw new Error("Too many attachment redirects");
  }
}
