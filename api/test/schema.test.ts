import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	areas,
	sections,
	serverSeq,
	settings,
	tasks,
	tombstones,
} from "../src/schema.ts";

const TABLES: Record<string, PgTable> = {
	areas,
	sections,
	tasks,
	settings,
	tombstones,
};

const columnNames = (columns: unknown[]) =>
	columns.map((c) =>
		typeof c === "object" && c !== null && "name" in c ? String(c.name) : "",
	);

describe("data tables", () => {
	for (const [name, table] of Object.entries(TABLES)) {
		const config = getTableConfig(table);

		it(`${name} is keyed by the owner first, because ids repeat across accounts`, () => {
			expect(config.primaryKeys).toHaveLength(1);
			expect(columnNames(config.primaryKeys[0].columns)).toEqual(
				name === "tombstones" ? ["user_id", "store", "id"] : ["user_id", "id"],
			);
		});

		it(`${name} is deleted with its user (ON DELETE CASCADE)`, () => {
			expect(config.foreignKeys).toHaveLength(1);
			const fk = config.foreignKeys[0];
			const ref = fk.reference();
			expect(fk.onDelete).toBe("cascade");
			expect(columnNames(ref.columns)).toEqual(["user_id"]);
			expect(getTableConfig(ref.foreignTable).name).toBe("user");
			expect(columnNames(ref.foreignColumns)).toEqual(["id"]);
		});

		it(`${name} has an index on (user_id, server_seq) for pull`, () => {
			const indexed = config.indexes.map((i) =>
				columnNames(i.config.columns).join(","),
			);
			expect(indexed).toContain("user_id,server_seq");
		});

		it(`${name} takes server_seq from the shared sequence`, () => {
			const column = config.columns.find((c) => c.name === "server_seq");
			expect(column?.notNull).toBe(true);
			expect(column?.hasDefault).toBe(true);
		});
	}

	it("has one shared sequence named server_seq_seq", () => {
		expect(serverSeq.seqName).toBe("server_seq_seq");
	});
});
