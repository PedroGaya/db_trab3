import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.text("id").primary();
    t.text("name").notNullable();
    t.text("email").notNullable().unique();
    t.text("city").notNullable();
    t.text("created_at").notNullable();
    t.index("city");
  });

  await knex.schema.createTable("posts", (t) => {
    t.text("id").primary();
    t.text("author_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.text("body").notNullable();
    t.text("created_at").notNullable();
    t.index(["author_id", "created_at"]);
  });

  await knex.schema.createTable("follows", (t) => {
    t.text("follower_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.text("followee_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.text("since").notNullable();
    t.primary(["follower_id", "followee_id"]);
    t.index("followee_id");
    t.check("?? <> ??", ["follower_id", "followee_id"], "no_self_follow");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("follows");
  await knex.schema.dropTableIfExists("posts");
  await knex.schema.dropTableIfExists("users");
}
