import { dirname } from "node:path";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";

export class JsonDedupeStore {
  constructor(path) {
    this.path = path;
    this.ids = new Set();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      for (const id of parsed.processedIds ?? []) this.ids.add(String(id));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async has(id) {
    await this.load();
    return this.ids.has(String(id));
  }

  async add(id) {
    await this.load();
    this.ids.add(String(id));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify({ processedIds: [...this.ids].sort() }, null, 2)}\n`,
    );
  }
}

export async function writeDeadLetter(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`);
}
