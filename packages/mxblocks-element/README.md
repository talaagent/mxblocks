# mxblocks-element

Element Web runtime module for mxblocks rich messages. The package builds an
ES module (`dist/mxblocks-rich.js`), a source map, and KaTeX fonts in `dist/fonts`.
It uses Element's React instance. Serve the entire `dist` directory from the
same origin and list the module in Element's `config.json`.

```json
{
  "modules": ["/modules/mxblocks-rich.js"],
  "com.talaagent.mxblocks": {
    "senders": ["@bot:example.org"],
    "write_key": "org.example.blocks",
    "read_keys": ["org.example.previous"]
  }
}
```

The writer key is also read; explicit aliases follow it. Custom namespaces
accept no implicit compatibility aliases. Without custom keys, the two public
namespaces are accepted and `write_key` can select `legacy` or `new`. Sender
allow-list validation remains mandatory; no valid senders means no rendering.
The same configured namespaces apply to rich payloads, click echoes (`.used`),
and gallery markers (`.album`).

From the repository root, run `pnpm --filter @talaagent/mxblocks-element typecheck`,
`pnpm --filter @talaagent/mxblocks-element test`, or `pnpm --filter @talaagent/mxblocks-element build`.
The Nix artifact is `nix build .#element-module`.

Apache-2.0. See LICENSE and NOTICE for bundled dependencies and font attribution.
