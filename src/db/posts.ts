export type PostStatus = 'draft' | 'unlisted' | 'listed';

export const VALID_STATUSES: readonly PostStatus[] = ['draft', 'unlisted', 'listed'];

export function validateStatus(raw: string, fallback: PostStatus): PostStatus {
  return (VALID_STATUSES as readonly string[]).includes(raw) ? raw as PostStatus : fallback;
}

export interface Post {
  id: number;
  slug: string;
  title: string;
  source: string;
  rendered: string;
  has_math: number;
  status: PostStatus;
  created_at: string;
  updated_at: string;
}

export interface PostWithTags extends Post {
  tags: string[];
}

export interface PostInput {
  slug: string;
  title: string;
  source: string;
  rendered: string;
  hasMath: boolean;
  tags: string[];
  status?: PostStatus;
}

export class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: ${slug}`);
    this.name = "DuplicateSlugError";
  }
}

async function attachTags(db: D1Database, posts: Post[]): Promise<PostWithTags[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ post_id: number; tag: string }>();

  const tagsByPost = new Map<number, string[]>();
  for (const row of results) {
    const list = tagsByPost.get(row.post_id) ?? [];
    list.push(row.tag);
    tagsByPost.set(row.post_id, list);
  }
  return posts.map((p) => ({ ...p, tags: tagsByPost.get(p.id) ?? [] }));
}

export async function createPost(db: D1Database, input: PostInput): Promise<PostWithTags> {
  if (await isSlugTaken(db, input.slug)) throw new DuplicateSlugError(input.slug);

  const now = new Date().toISOString();
  const status = input.status ?? 'draft';
  const insertPost = db
    .prepare(
      `INSERT INTO posts (slug, title, source, rendered, has_math, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.slug, input.title, input.source, input.rendered, input.hasMath ? 1 : 0, status, now, now);

  const result = await insertPost.run();
  const id = result.meta.last_row_id as number;

  if (input.tags.length > 0) {
    try {
      const tagInserts = input.tags.map((tag) =>
        db.prepare(`INSERT INTO post_tags (post_id, tag) VALUES (?, ?)`).bind(id, tag),
      );
      await db.batch(tagInserts);
    } catch (e) {
      // The post row and its tags can't be inserted in one D1 batch (the
      // tag rows need the post's id, which only exists after the post
      // insert commits). If the tag batch fails, remove the now-orphaned
      // post rather than leaving a tag-less post behind silently.
      await db.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
      throw e;
    }
  }

  const created = await getPostById(db, id);
  if (!created) throw new Error("Failed to read back created post");
  return created;
}

export async function updatePost(
  db: D1Database,
  id: number,
  input: PostInput,
): Promise<PostWithTags> {
  if (await isSlugTaken(db, input.slug, id)) throw new DuplicateSlugError(input.slug);

  const now = new Date().toISOString();
  // updatePost requires an explicit status (the editor form always submits
  // one).  No fallback — silently defaulting to 'draft' would invert the
  // old safe default (listed), and a missing status is always a caller bug.
  const status = input.status!;
  const updatePostStmt = db
    .prepare(
      `UPDATE posts SET slug = ?, title = ?, source = ?, rendered = ?, has_math = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.slug, input.title, input.source, input.rendered, input.hasMath ? 1 : 0, status, now, id);
  const deleteTagsStmt = db.prepare(`DELETE FROM post_tags WHERE post_id = ?`).bind(id);
  const tagInserts = input.tags.map((tag) =>
    db.prepare(`INSERT INTO post_tags (post_id, tag) VALUES (?, ?)`).bind(id, tag),
  );

  // The id is already known here (unlike createPost), so the post update and
  // the full tag replacement can be one atomic D1 batch -- no window where a
  // failure between the delete and the re-insert could leave the post with
  // zero tags.
  await db.batch([updatePostStmt, deleteTagsStmt, ...tagInserts]);

  const updated = await getPostById(db, id);
  if (!updated) throw new Error("Failed to read back updated post");
  return updated;
}

export async function deletePost(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
}

export async function getPostBySlug(db: D1Database, slug: string): Promise<PostWithTags | null> {
  const post = await db.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<Post>();
  if (!post) return null;
  const [withTags] = await attachTags(db, [post]);
  return withTags;
}

/** Like getPostBySlug but returns null for draft posts — the public read path
 *  should never surface a draft. */
export async function getPublicPostBySlug(db: D1Database, slug: string): Promise<PostWithTags | null> {
  const post = await getPostBySlug(db, slug);
  if (!post || post.status === 'draft') return null;
  return post;
}

export async function getPostById(db: D1Database, id: number): Promise<PostWithTags | null> {
  const post = await db.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first<Post>();
  if (!post) return null;
  const [withTags] = await attachTags(db, [post]);
  return withTags;
}

export async function listPosts(db: D1Database, listedOnly = false): Promise<PostWithTags[]> {
  const query = listedOnly
    ? `SELECT * FROM posts WHERE status = 'listed' ORDER BY created_at DESC`
    : `SELECT * FROM posts ORDER BY created_at DESC`;
  const { results } = await db.prepare(query).all<Post>();
  return attachTags(db, results);
}

export async function listPostsByTag(db: D1Database, tag: string, listedOnly = false): Promise<PostWithTags[]> {
  const query = listedOnly
    ? `SELECT posts.* FROM posts
       JOIN post_tags ON post_tags.post_id = posts.id
       WHERE post_tags.tag = ? AND posts.status = 'listed'
       ORDER BY posts.created_at DESC`
    : `SELECT posts.* FROM posts
       JOIN post_tags ON post_tags.post_id = posts.id
       WHERE post_tags.tag = ?
       ORDER BY posts.created_at DESC`;
  const { results } = await db.prepare(query).bind(tag).all<Post>();
  return attachTags(db, results);
}

export async function isSlugTaken(db: D1Database, slug: string, excludeId?: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM posts WHERE slug = ? AND id != ?`)
    .bind(slug, excludeId ?? -1)
    .first<{ id: number }>();
  return row !== null;
}
