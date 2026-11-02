-- Tag posts and group channels to a world market (see config.data.worldMarkets)
ALTER TABLE posts ADD COLUMN exchange TEXT;
ALTER TABLE group_channels ADD COLUMN exchange TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_exchange ON posts(exchange);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);
