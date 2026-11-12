// SPDX-FileCopyrightText: Copyright (C) 2026 Telelian
// SPDX-License-Identifier: MPL-2.0

import Log from "@lichtblick/log";
import {
  IExtensionLoader,
  InstallExtensionProps,
  LoadedExtension,
  TypeExtensionLoader,
} from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import { ALLOWED_FILES } from "@lichtblick/suite-base/services/extension/types";
import decompressFile from "@lichtblick/suite-base/services/extension/utils/decompressFile";
import extractFoxeFileContent from "@lichtblick/suite-base/services/extension/utils/extractFoxeFileContent";
import validatePackageInfo from "@lichtblick/suite-base/services/extension/utils/validatePackageInfo";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

const log = Log.getLogger(__filename);

type Bundled = { info: ExtensionInfo; raw: string };

/**
 * Read-only extensions served next to the web app (static hosting, e.g. GitHub Pages).
 *
 * `<base>/extensions/index.json` lists `.foxe` files relative to that folder, e.g.
 * `["cloudini.foxe", "panels.foxe"]`. A missing index means no bundled extensions, so a
 * normal deployment is unaffected. Visitors get the extensions without installing anything.
 */
export class BundledExtensionLoader implements IExtensionLoader {
  public readonly namespace: Namespace;
  public readonly type: TypeExtensionLoader = "server";
  readonly #indexUrl: URL;
  #loaded?: Promise<Map<string, Bundled>>;

  public constructor(namespace: Namespace, indexUrl: URL) {
    this.namespace = namespace;
    this.#indexUrl = indexUrl;
  }

  async #load(): Promise<Map<string, Bundled>> {
    const out = new Map<string, Bundled>();
    let files: string[] = [];
    try {
      const res = await fetch(this.#indexUrl);
      if (!res.ok) {
        return out;
      }
      files = (await res.json()) as string[];
    } catch {
      return out;
    }
    for (const file of files) {
      try {
        const res = await fetch(new URL(file, this.#indexUrl));
        const foxe = new Uint8Array(await res.arrayBuffer());
        const unzipped = await decompressFile(foxe);
        const pkg = await extractFoxeFileContent(unzipped, ALLOWED_FILES.PACKAGE);
        const raw = await extractFoxeFileContent(unzipped, ALLOWED_FILES.EXTENSION);
        if (!pkg || !raw) {
          log.warn(`[Bundled] ${file}: missing package.json or extension source`);
          continue;
        }
        const rawInfo = validatePackageInfo(JSON.parse(pkg) as Partial<ExtensionInfo>);
        const publisher = rawInfo.publisher.replace(/[^A-Za-z0-9_\s]+/g, "");
        const info: ExtensionInfo = {
          ...rawInfo,
          id: `${publisher}.${rawInfo.name}`,
          namespace: this.namespace,
          qualifiedName: rawInfo.displayName || rawInfo.name,
          readme: "",
          changelog: "",
          size: foxe.length,
        };
        out.set(info.id, { info, raw });
      } catch (err) {
        log.warn(`[Bundled] ${file}: ${String(err)}`);
      }
    }
    return out;
  }

  #all(): Promise<Map<string, Bundled>> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  public async getExtension(id: string): Promise<ExtensionInfo | undefined> {
    return (await this.#all()).get(id)?.info;
  }

  public async getExtensions(): Promise<ExtensionInfo[]> {
    return [...(await this.#all()).values()].map((b) => b.info);
  }

  public async loadExtension(id: string): Promise<LoadedExtension> {
    const found = (await this.#all()).get(id);
    if (!found) {
      throw new Error("Extension not found");
    }
    return { raw: found.raw };
  }

  public async installExtension(_data: InstallExtensionProps): Promise<ExtensionInfo> {
    throw new Error("Bundled extensions are read-only");
  }

  public async uninstallExtension(_id: string): Promise<void> {
    throw new Error("Bundled extensions are read-only");
  }
}
