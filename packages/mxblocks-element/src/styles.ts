// Styles use Element's Compound tokens (--cpd-*), which the light, dark and
// high-contrast themes all define, so blocks follow the active theme. Chart
// series colours are the dataviz reference categorical palette (first six
// slots, fixed order), light steps by default and dark steps under Element's
// cpd-theme-dark* class.

const CSS = `
.mxblocks {
  --mxblocks-s1: #2a78d6; --mxblocks-s2: #eb6834; --mxblocks-s3: #1baf7a;
  --mxblocks-s4: #eda100; --mxblocks-s5: #e87ba4; --mxblocks-s6: #008300;
  --mxblocks-up: var(--cpd-color-text-success-primary, #0b7d3e);
  --mxblocks-down: var(--cpd-color-text-critical-primary, #d51928);
  --mxblocks-border: var(--cpd-color-border-interactive-secondary, rgba(128,128,128,.35));
  --mxblocks-subtle: var(--cpd-color-bg-subtle-secondary, rgba(128,128,128,.08));
  display: flex; flex-direction: column; gap: 8px; margin-top: 6px;
  max-width: 100%; min-width: 0;
  font: var(--cpd-font-body-md-regular);
  color: var(--cpd-color-text-primary);
}
.cpd-theme-dark .mxblocks, .cpd-theme-dark-hc .mxblocks {
  --mxblocks-s1: #3987e5; --mxblocks-s2: #d95926; --mxblocks-s3: #199e70;
  --mxblocks-s4: #c98500; --mxblocks-s5: #d55181; --mxblocks-s6: #008300;
}
.mxblocks_muted { color: var(--cpd-color-text-secondary); font: var(--cpd-font-body-sm-regular); }
.mxblocks_title { font: var(--cpd-font-body-sm-semibold); color: var(--cpd-color-text-primary); }
.mxblocks_num { font-variant-numeric: tabular-nums; }
.mxblocks_mono, .mxblocks pre, .mxblocks code { font-family: var(--cpd-font-family-mono, ui-monospace, monospace); }
.mxblocks_pre { white-space: pre-wrap; font: var(--cpd-font-body-sm-regular); }
.mxblocks_head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 24px; }
.mxblocks_head > .mxblocks_title { flex: 1 1 auto; min-width: 0; }
.mxblocks_error { color: var(--cpd-color-text-critical-primary); font: var(--cpd-font-body-sm-regular); }

/* buttons / chips */
.mxblocks_buttons, .mxblocks_chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mxblocks_btn {
  appearance: none; display: inline-flex; align-items: center; gap: 2px;
  border: 1px solid var(--mxblocks-border);
  background: var(--cpd-color-bg-canvas-default);
  color: var(--cpd-color-text-primary);
  border-radius: 15px; padding: 4px 14px; max-width: 100%; text-align: start;
  font: var(--cpd-font-body-sm-medium, var(--cpd-font-body-sm-regular)); line-height: 20px;
  cursor: pointer; text-decoration: none; white-space: normal; overflow-wrap: anywhere;
}
.mxblocks_btn:hover:not(:disabled) { background: var(--mxblocks-subtle); border-color: var(--cpd-color-border-interactive-hovered); text-decoration: none; }
.mxblocks_btn:focus-visible { outline: 2px solid var(--cpd-color-border-focused, var(--cpd-color-icon-accent-primary)); outline-offset: 1px; }
.mxblocks_btn:disabled { opacity: .5; cursor: default; }
.mxblocks_btn--small { padding: 1px 10px; font: var(--cpd-font-body-xs-medium, var(--cpd-font-body-sm-regular)); line-height: 20px; }
.mxblocks_btn--chip { padding: 2px 12px; background: var(--mxblocks-subtle); border-color: transparent; }
.mxblocks_btn--danger { color: var(--cpd-color-text-critical-primary); }
.mxblocks_btn--danger:hover:not(:disabled) { background: var(--cpd-color-bg-critical-subtle); border-color: var(--cpd-color-border-critical-primary); }
.mxblocks_btn--primary { background: var(--cpd-color-bg-action-primary-rest); border-color: var(--cpd-color-bg-action-primary-rest); color: var(--cpd-color-text-on-solid-primary); }
.mxblocks_btn--primary:hover:not(:disabled) { background: var(--cpd-color-bg-action-primary-hovered, var(--cpd-color-bg-action-primary-rest)); color: var(--cpd-color-text-on-solid-primary); }
.mxblocks_btn--done { box-shadow: inset 0 0 0 1px currentColor; font-weight: 600; }
.mxblocks_btn--done:not(.mxblocks_btn--primary) { background: var(--mxblocks-subtle); }
.mxblocks_count { margin-left: 6px; padding: 0 6px; border-radius: 999px; font: var(--cpd-font-body-xs-regular, var(--cpd-font-body-sm-regular)); background: var(--cpd-color-bg-subtle-primary); color: var(--cpd-color-text-secondary); }

/* shared container look */
.mxblocks_table, .mxblocks_chart, .mxblocks_progress, .mxblocks_code, .mxblocks_details,
.mxblocks_card--wide, .mxblocks_event, .mxblocks_place, .mxblocks_ticker, .mxblocks_weather,
.mxblocks_tracker {
  border: 1px solid var(--mxblocks-border); border-radius: 8px; padding: 8px 10px;
  max-width: 560px; min-width: 0; box-sizing: border-box; margin: 0;
}

/* table */
.mxblocks_table { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
.mxblocks_scroll { overflow: auto; max-height: 360px; }
.mxblocks_table table { border-collapse: collapse; font: var(--cpd-font-body-sm-regular); min-width: 100%; }
.mxblocks_table th, .mxblocks_table td { padding: 3px 10px; border-bottom: 1px solid var(--mxblocks-border); white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.mxblocks_table th { position: sticky; top: 0; background: var(--cpd-color-bg-canvas-default); }
.mxblocks_table th button { all: unset; cursor: pointer; font: var(--cpd-font-body-sm-semibold); }
.mxblocks_table th button:focus-visible { outline: 2px solid var(--cpd-color-border-focused); }
.mxblocks_table tbody tr:hover { background: var(--mxblocks-subtle); }
.mxblocks_sort { color: var(--cpd-color-text-secondary); font-size: 10px; }

/* chart */
.mxblocks_chart svg { display: block; width: 100%; height: auto; }
.mxblocks_grid { stroke: var(--mxblocks-border); stroke-width: 1; }
.mxblocks_axis { fill: var(--cpd-color-text-secondary); font-size: 10px; }
.mxblocks_cross { stroke: var(--cpd-color-text-secondary); stroke-width: 1; stroke-dasharray: 2 2; }
.mxblocks_dot { stroke: var(--cpd-color-bg-canvas-default); stroke-width: 2; }
.mxblocks_legend, .mxblocks_readout { display: flex; flex-wrap: wrap; gap: 2px 10px; font: var(--cpd-font-body-xs-regular, var(--cpd-font-body-sm-regular)); color: var(--cpd-color-text-secondary); }
.mxblocks_readout b { color: var(--cpd-color-text-primary); }
.mxblocks_swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: 0; }
.mxblocks_sparkRow { display: flex; align-items: center; gap: 10px; }
.mxblocks_spark { flex: none; overflow: visible; }

/* sources */
.mxblocks_sources { display: flex; flex-wrap: wrap; gap: 6px; }
.mxblocks_source {
  display: inline-flex; align-items: center; gap: 6px; max-width: 260px;
  padding: 2px 10px 2px 3px; border-radius: 999px; background: var(--mxblocks-subtle);
  color: var(--cpd-color-text-primary); text-decoration: none; font: var(--cpd-font-body-sm-regular);
}
.mxblocks_source:hover { background: var(--cpd-color-bg-subtle-primary); text-decoration: none; }
.mxblocks_sourceTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mxblocks_source .mxblocks_muted { white-space: nowrap; }
.mxblocks_badge {
  flex: none; width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center;
  background: var(--cpd-color-bg-action-primary-rest); color: var(--cpd-color-text-on-solid-primary);
  font: var(--cpd-font-body-xs-semibold, var(--cpd-font-body-sm-semibold)); font-size: 10px;
}

/* cards */
.mxblocks_card { display: flex; gap: 10px; min-width: 0; }
.mxblocks_card--tall { flex-direction: column; gap: 6px; width: 200px; border: 1px solid var(--mxblocks-border); border-radius: 8px; overflow: hidden; height: 100%; box-sizing: border-box; }
.mxblocks_card--tall .mxblocks_cardBody { padding: 0 10px 8px; }
.mxblocks_card--tall .mxblocks_img { width: 200px; height: 120px; border-radius: 0; }
.mxblocks_img { flex: none; object-fit: cover; border-radius: 6px; background: var(--mxblocks-subtle); }
.mxblocks_cardBody { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.mxblocks_cardTitle { font: var(--cpd-font-body-md-semibold); color: var(--cpd-color-text-primary); overflow-wrap: anywhere; }
a.mxblocks_cardTitle { color: var(--cpd-color-text-link-external, var(--cpd-color-text-action-accent)); }
.mxblocks_cardMeta { display: flex; gap: 8px; align-items: baseline; color: var(--cpd-color-text-secondary); font: var(--cpd-font-body-sm-regular); }
.mxblocks_price { color: var(--cpd-color-text-primary); font: var(--cpd-font-body-md-semibold); }
.mxblocks_fields { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; margin: 4px 0 0; font: var(--cpd-font-body-sm-regular); }
.mxblocks_fields dt { color: var(--cpd-color-text-secondary); }
.mxblocks_fields dd { margin: 0; overflow-wrap: anywhere; }
.mxblocks_cardList { display: flex; flex-direction: column; gap: 6px; }
.mxblocks_card .mxblocks_buttons { margin-top: 6px; }
/* math (KaTeX; glyphs take the theme's text colour) */
.mxblocks--mathOnly { margin-top: 0; }
.mxblocks_math { margin: 0; max-width: 100%; min-width: 0; }
.mxblocks_mathDisplay .mxblocks_mathBody { display: block; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.mxblocks_mathDisplay .katex-display { margin: 4px 0; text-align: left; }
.mxblocks_mathDisplay .katex-display > .katex { text-align: left; }
.mxblocks_mathInline .katex { font-size: 1.1em; }
.mxblocks_mathCaption { color: var(--cpd-color-text-secondary); font: var(--cpd-font-body-sm-regular); margin-top: 2px; }
.mxblocks_mathSource { white-space: pre-wrap; word-break: break-word; }
.mxblocks_fallback { white-space: pre-wrap; color: var(--cpd-color-text-secondary); font: var(--cpd-font-body-sm-regular); }
.mxblocks_carousel { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; max-width: 100%; }
.mxblocks_carousel > * { scroll-snap-align: start; flex: none; }

/* progress */
.mxblocks_progress ol { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.mxblocks_step { display: flex; align-items: flex-start; gap: 8px; font: var(--cpd-font-body-sm-regular); }
.mxblocks_stepText { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.mxblocks_stepDetail { color: var(--cpd-color-text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.mxblocks_stepIcon { flex: none; width: 16px; height: 20px; display: inline-grid; place-items: center; color: var(--cpd-color-text-secondary); }
.mxblocks_step--done .mxblocks_stepIcon { color: var(--mxblocks-up); font-weight: 700; }
.mxblocks_step--failed .mxblocks_stepIcon, .mxblocks_step--failed .mxblocks_stepText > span:first-child { color: var(--mxblocks-down); }
.mxblocks_step--skipped .mxblocks_stepText > span:first-child { color: var(--cpd-color-text-secondary); text-decoration: line-through; }
.mxblocks_step--pending .mxblocks_stepText > span:first-child { color: var(--cpd-color-text-secondary); }
.mxblocks_spinner { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--mxblocks-border); border-top-color: var(--cpd-color-icon-accent-primary, var(--mxblocks-s1)); animation: mxblocks-spin .8s linear infinite; }
@keyframes mxblocks-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mxblocks_spinner { animation-duration: 3s; } }
.mxblocks_summary { margin-top: 6px; white-space: pre-wrap; font: var(--cpd-font-body-sm-regular); }

/* details / code / diff */
.mxblocks_details summary { cursor: pointer; font: var(--cpd-font-body-sm-semibold); }
.mxblocks_details pre, .mxblocks_code pre {
  margin: 6px 0 0; padding: 6px 8px; max-height: 360px; overflow: auto; border-radius: 6px;
  background: var(--mxblocks-subtle); font-size: 12px; line-height: 1.45; white-space: pre; tab-size: 4;
}
.mxblocks_details pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.mxblocks_code .mxblocks_head > .mxblocks_mono { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mxblocks_code code { display: inline-block; min-width: 100%; }
.mxblocks_diffLine { display: block; }
.mxblocks_diffAdd { background: var(--cpd-color-bg-success-subtle, rgba(0,160,80,.15)); color: var(--cpd-color-text-success-primary); }
.mxblocks_diffDel { background: var(--cpd-color-bg-critical-subtle, rgba(220,30,40,.12)); color: var(--cpd-color-text-critical-primary); }
.mxblocks_diffHunk { color: var(--cpd-color-text-info-primary, var(--cpd-color-text-secondary)); }
.mxblocks_diffFile { font-weight: 600; }

/* countdown / event / place */
.mxblocks_countdown { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; padding: 3px 12px; border-radius: 999px; background: var(--mxblocks-subtle); font: var(--cpd-font-body-sm-regular); }
.mxblocks_event, .mxblocks_place { display: flex; gap: 10px; }
.mxblocks_date { flex: none; width: 44px; display: flex; flex-direction: column; align-items: center; border-radius: 6px; overflow: hidden; border: 1px solid var(--mxblocks-border); align-self: flex-start; }
.mxblocks_date span { width: 100%; text-align: center; font: var(--cpd-font-body-xs-semibold, var(--cpd-font-body-sm-semibold)); text-transform: uppercase; background: var(--cpd-color-bg-critical-primary, #d51928); color: var(--cpd-color-text-on-solid-primary, #fff); }
.mxblocks_date b { font: var(--cpd-font-heading-sm-semibold, var(--cpd-font-body-lg-semibold)); padding: 2px 0; }
.mxblocks_event .mxblocks_cardBody > span:last-child, .mxblocks_place .mxblocks_cardBody > span:last-child { margin-top: 4px; }
.mxblocks_placeIcon { font-size: 22px; line-height: 1; }

/* ticker / weather */
.mxblocks_ticker { display: flex; align-items: center; gap: 12px; }
.mxblocks_tickerPrice { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.mxblocks_tickerPrice > b { font: var(--cpd-font-body-lg-semibold); }
.mxblocks_up { color: var(--mxblocks-up); }
.mxblocks_down { color: var(--mxblocks-down); }
.mxblocks_weatherNow { display: flex; align-items: center; gap: 10px; }
.mxblocks_weatherIcon { font-size: 30px; line-height: 1; }
.mxblocks_weatherTemp { font: var(--cpd-font-heading-md-semibold, var(--cpd-font-body-lg-semibold)); font-variant-numeric: tabular-nums; }
.mxblocks_forecast { display: flex; gap: 4px; margin-top: 8px; overflow-x: auto; }
.mxblocks_forecast > div { flex: 1 0 52px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; border-radius: 6px; background: var(--mxblocks-subtle); font: var(--cpd-font-body-sm-regular); }

/* tracker: live order/ride/parcel status, updated in place by edits */
.mxblocks_tracker { display: flex; flex-direction: column; gap: 6px; }
.mxblocks_trackerHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mxblocks_trackerHead > .mxblocks_cardBody { flex: 1 1 160px; }
.mxblocks_trackerIcon { font-size: 22px; line-height: 1; }
.mxblocks_trackerTitle { font: var(--cpd-font-body-md-semibold); overflow-wrap: anywhere; }
.mxblocks_trackerStatus { font: var(--cpd-font-body-sm-regular); }
.mxblocks_tracker--done .mxblocks_trackerStatus { color: var(--mxblocks-up); }
.mxblocks_tracker--cancelled .mxblocks_trackerStatus, .mxblocks_tracker--cancelled .mxblocks_trackerIcon { color: var(--mxblocks-down); }
.mxblocks_trackerHead .mxblocks_countdown { align-self: center; }
.mxblocks_stages { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 4px; font: var(--cpd-font-body-sm-regular); }
.mxblocks_stage { display: inline-flex; align-items: center; gap: 2px; }
.mxblocks_stage + .mxblocks_stage::before { content: "›"; color: var(--cpd-color-text-secondary); margin-right: 4px; }
.mxblocks_stage.mxblocks_step--pending .mxblocks_stageLabel, .mxblocks_stage.mxblocks_step--skipped .mxblocks_stageLabel { color: var(--cpd-color-text-secondary); }
.mxblocks_stage.mxblocks_step--skipped .mxblocks_stageLabel { text-decoration: line-through; }
.mxblocks_stage.mxblocks_step--running .mxblocks_stageLabel { font: var(--cpd-font-body-sm-semibold); }
.mxblocks_stage.mxblocks_step--done .mxblocks_stepIcon { color: var(--mxblocks-up); font-weight: 700; }
.mxblocks_stage.mxblocks_step--failed .mxblocks_stepIcon, .mxblocks_stage.mxblocks_step--failed .mxblocks_stageLabel { color: var(--mxblocks-down); }
.mxblocks_tracker > .mxblocks_img { align-self: flex-start; }
.mxblocks_trackerRow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font: var(--cpd-font-body-sm-regular); }
.mxblocks_trackerRow .mxblocks_btn { margin-left: auto; }
.mxblocks_trackerItems { overflow-wrap: anywhere; }
/* trackers are edited every 30-60 s; the "(edited)" marker is noise there */
.mx_EventTile:has(.mxblocks_tracker) .mx_EventTile_edited { display: none; }
/* gallery */
.mxblocks_caption { white-space: pre-wrap; overflow-wrap: anywhere; }
.mxblocks_gallery { display: flex; flex-direction: column; gap: 4px; max-width: 100%; min-width: 0; }
.mxblocks_galleryRow { display: flex; gap: 6px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; max-width: 100%; }
.mxblocks_galleryItem { flex: none; margin: 0; scroll-snap-align: start; display: flex; flex-direction: column; gap: 2px; }
.mxblocks_galleryItem figcaption { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.mxblocks_galleryBtn { all: unset; cursor: zoom-in; display: block; border-radius: 8px; overflow: hidden; background: var(--mxblocks-subtle); }
.mxblocks_galleryBtn:focus-visible { outline: 2px solid var(--cpd-color-border-focused); outline-offset: 1px; }
.mxblocks_galleryImg, .mxblocks_imgMissing, .mxblocks_imgLoading { display: block; width: 100%; height: 100%; object-fit: cover; }
.mxblocks_imgMissing { display: grid; place-items: center; color: var(--cpd-color-text-secondary); font-size: 24px; }
.mxblocks_imgLoading { background: var(--mxblocks-subtle); }
.mxblocks_lightbox { border: none; padding: 0; background: transparent; max-width: 96vw; max-height: 96vh; overflow: visible; color: var(--cpd-color-text-primary); }
.mxblocks_lightbox::backdrop { background: rgba(0,0,0,.85); }
.mxblocks_lightboxImg { display: block; max-width: 96vw; max-height: calc(96vh - 52px); object-fit: contain; margin: 0 auto; }
.mxblocks_lightbox .mxblocks_imgMissing, .mxblocks_lightbox .mxblocks_imgLoading { width: 320px; height: 240px; }
.mxblocks_lightboxBar { display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 8px; flex-wrap: wrap; }
.mxblocks_lightboxCaption { color: #fff; font: var(--cpd-font-body-sm-regular); max-width: 60vw; overflow-wrap: anywhere; }
.mxblocks_albumHidden { display: none !important; }

/* file */
.mxblocks_file { border: 1px solid var(--mxblocks-border); border-radius: 8px; padding: 8px 10px; max-width: 560px; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; }
.mxblocks_fileHead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mxblocks_fileHead .mxblocks_cardTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mxblocks_fileIcon { flex: none; width: 40px; height: 48px; border-radius: 6px; display: grid; place-items: center; background: var(--mxblocks-subtle); border: 1px solid var(--mxblocks-border); font: var(--cpd-font-body-xs-semibold, var(--cpd-font-body-sm-semibold)); font-size: 10px; color: var(--cpd-color-text-secondary); }
.mxblocks_fileThumb { width: 48px; height: 48px; }
.mxblocks_filePreview { margin: 0; padding: 6px 8px; max-height: 320px; overflow: auto; border-radius: 6px; background: var(--mxblocks-subtle); font-size: 12px; line-height: 1.45; white-space: pre; tab-size: 4; }

/* form */
.mxblocks_form { border: 1px solid var(--mxblocks-border); border-radius: 8px; padding: 8px 10px; max-width: 420px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; }
.mxblocks_formField { display: flex; flex-direction: column; gap: 3px; font: var(--cpd-font-body-sm-regular); }
.mxblocks_formLabel { font: var(--cpd-font-body-sm-semibold); }
.mxblocks_input { font: var(--cpd-font-body-md-regular); color: var(--cpd-color-text-primary); background: var(--cpd-color-bg-canvas-default); border: 1px solid var(--mxblocks-border); border-radius: 6px; padding: 4px 8px; min-width: 0; max-width: 100%; box-sizing: border-box; }
.mxblocks_input:focus-visible { outline: 2px solid var(--cpd-color-border-focused); outline-offset: 0; }
.mxblocks_input:disabled { opacity: .7; }
.mxblocks_radios { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.mxblocks_check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.mxblocks_check .mxblocks_formLabel { font: var(--cpd-font-body-sm-regular); }
`;

export function injectStyles(): void {
  if (document.getElementById("mxblocks-rich-css")) return;
  const style = document.createElement("style");
  style.id = "mxblocks-rich-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}
