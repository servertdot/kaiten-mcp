export interface KaitenUser {
  id: number;
  uid?: string;
  full_name?: string;
  username?: string;
  email?: string;
}

export interface KaitenColumn {
  id: number;
  title: string;
  type: number;
  board_id: number;
  column_id?: number | null;
}

export interface KaitenLane {
  id: number;
  title: string;
  board_id: number;
}

export interface KaitenBoard {
  id: number;
  title: string;
  columns?: KaitenColumn[];
  lanes?: KaitenLane[];
  spaces?: Array<{ id: number; title: string }>;
}

export interface KaitenChecklistSummary {
  id: number;
  name: string;
  checked_items?: number;
  total_items?: number;
  items?: KaitenChecklistItem[] | null;
}

export interface KaitenChecklistItem {
  id: number;
  text: string;
  checked: boolean;
  due_date?: string | null;
  responsible_id?: number | null;
}

export interface KaitenFile {
  id: number;
  url: string;
  name: string;
  type: number;
  size: number;
  mime_type?: string | null;
  deleted?: boolean;
  comment_id?: number | null;
}

export interface KaitenAlias {
  key?: string;
  actual?: boolean;
}

export type KaitenCustomPropertyValue =
  | null
  | string
  | number
  | boolean
  | KaitenCustomPropertyValue[]
  | { [key: string]: KaitenCustomPropertyValue };

export interface KaitenCustomProperty {
  id: number;
  name: string;
  type: string;
  condition?: string;
  multiline?: boolean;
  multi_select?: boolean | null;
  values_type?: string | null;
  vote_variant?: string | null;
  protected?: boolean;
}

export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
}

export interface KaitenDocument {
  uid: string;
  id: number;
  title: string;
  created?: string;
  updated?: string;
  archived?: boolean;
  company_id?: number;
  author_id?: number;
  parent_entity_uid?: string | null;
  entity_type?: "document";
  access?: "for_everyone" | "by_invite";
  data?: ProseMirrorNode | null;
  version?: number;
  published_version?: number | null;
  publish_date?: string | null;
  public?: boolean;
  hidden_on_public_site?: boolean;
  key?: string | null;
  redirect_url?: string | null;
  path?: string;
  schema_version?: number;
}

export interface KaitenCard {
  id: number;
  key?: string;
  aliases?: KaitenAlias[];
  title: string;
  description?: string | null;
  updated?: string;
  board_id: number;
  column_id: number;
  lane_id?: number | null;
  owner_id?: number | null;
  due_date?: string | null;
  due_date_time_present?: boolean;
  asap?: boolean;
  size_text?: string | null;
  estimate_workload?: number | null;
  state?: number;
  condition?: number;
  version?: number;
  blocked?: boolean;
  comments_total?: number;
  children_count?: number;
  properties?: Record<string, KaitenCustomPropertyValue> | null;
  owner?: KaitenUser | null;
  members?: KaitenUser[];
  board?: KaitenBoard;
  column?: KaitenColumn;
  lane?: KaitenLane | null;
  checklists?: KaitenChecklistSummary[];
  files?: KaitenFile[];
  tags?: Array<{ id: number; name: string }>;
}

export interface KaitenComment {
  id: number;
  created?: string;
  updated?: string;
  text: string;
  type?: number;
  edited?: boolean;
  deleted?: boolean;
  internal?: boolean;
  author_id?: number;
  author?: KaitenUser;
}

export interface KaitenTimeLogRole {
  id: number;
  name?: string;
}

export interface KaitenTimeLog {
  id: number;
  card_id: number;
  user_id?: number;
  role_id: number;
  author_id?: number;
  updater_id?: number | null;
  time_spent: number;
  for_date: string;
  comment?: string | null;
  created?: string;
  updated?: string;
  role?: KaitenTimeLogRole | null;
  user?: KaitenUser | null;
  author?: KaitenUser | null;
}

export interface CardSearchResponse {
  result: KaitenCard[];
  position?: string;
}

export interface AttachmentContent {
  file: KaitenFile;
  contentType: string;
  bytes: Uint8Array;
}

export interface KaitenTag {
  id: number;
  name: string;
  color?: number | null;
}

export interface KaitenCardBlocker {
  id: number;
  card_id?: number;
  reason?: string | null;
  blocker_card_id?: number | null;
  created?: string;
  updated?: string;
}

export interface KaitenCardType {
  id: number;
  name: string;
  letter?: string | null;
  color?: number | null;
  archived?: boolean;
  description_template?: string | null;
}

export interface KaitenActivityEvent {
  id: number;
  created: string;
  action: string;
  author_id?: number | null;
  card_id?: number | null;
}

export interface KaitenActivityPage {
  items: KaitenActivityEvent[];
  limit: number;
  next_cursor: string | null;
}
