-- Development reset: global groups are discarded, without copying or backfilling data.
-- Spaces, members, expenses and settlements are unaffected.
DROP TABLE IF EXISTS space_group_shortcuts;
DROP TABLE group_members;
DROP TABLE groups;

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, id)
);
CREATE INDEX groups_space_created_idx ON groups (space_id, created_at DESC, id);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

-- No rows means automatic (latest three); positions persist an owner's custom order.
CREATE TABLE space_group_shortcuts (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 2),
  group_id uuid NOT NULL,
  PRIMARY KEY (space_id, position),
  UNIQUE (space_id, group_id),
  FOREIGN KEY (space_id, group_id) REFERENCES groups(space_id, id) ON DELETE CASCADE
);
