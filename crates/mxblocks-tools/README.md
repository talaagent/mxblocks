# mxblocks-tools

The `rich_send` / `rich_edit` tools for an LLM agent that posts
[mxblocks](https://github.com/talaagent/mxblocks/blob/main/README.md) messages: names, descriptions and input schemas
(`tool_specs`), a block-picking guide for prompts (`BLOCK_GUIDE`,
`prompt_line`), and the argument check (`plan`) that turns a call into a
validated payload, its text fallback and its targets (reply, thread, edit,
room). Sending is the caller's.

```rust
let specs = mxblocks_tools::tool_specs("!room:example.org");
assert_eq!(specs.len(), 2);
assert!(mxblocks_tools::is_rich_tool("rich_send"));
```

Apache-2.0.
