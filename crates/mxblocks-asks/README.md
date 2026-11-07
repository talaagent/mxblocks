# mxblocks-asks

Reaction asks for Matrix bots. A paragraph of a bot's reply with a marker,
`Deploy? [ask: ✅ deploy | ❌ skip]`, goes out as its own message reading
`Deploy? ✅ deploy · ❌ skip`, with an [mxblocks](https://github.com/talaagent/mxblocks/blob/main/README.md) buttons
block and the reactions to seed, so a reader taps one instead of typing.
Without a marker, a strict safety net catches `✅ to deploy, ❌ to skip`,
`react ✅` and `👍/👎?` at the end of the reply.

Pure: `plan` splits a reply and says what each message carries; seeding the
reactions and handling the taps is the caller's.

```rust
let (_, ask) = mxblocks_asks::take_marker("Deploy? [ask: ✅ deploy | ❌ skip]").unwrap();
assert_eq!(ask.opts.len(), 2);
```

Apache-2.0.
