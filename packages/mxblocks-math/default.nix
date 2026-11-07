# Deploy a self-contained production package; copying pnpm symlinks alone would break.
{
  lib,
  stdenv,
  nodejs,
  pnpm,
  pnpmConfigHook,
  resvg,
  dejavu_fonts,
  coreutils,
  runtimeShell,
  src,
  pnpmDeps,
}:
stdenv.mkDerivation {
  pname = "mxblocks-math";
  version = (lib.importJSON ./package.json).version;
  inherit src pnpmDeps;
  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
  ];
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    lib=$out/lib/mxblocks-math
    mkdir -p $out/bin
    pnpm --filter @talaagent/mxblocks-math deploy --prod --offline --ignore-scripts "$lib"
    cat > $out/bin/mxblocks-math <<SH
    #!${runtimeShell}
    export MXBLOCKS_MATH_RESVG=${lib.getExe resvg}
    export MXBLOCKS_MATH_FONT_DIR=${dejavu_fonts}/share/fonts/truetype
    exec ${coreutils}/bin/timeout -k 2 "\''${MXBLOCKS_MATH_TIMEOUT:-20}" ${lib.getExe nodejs} $lib/src/mxblocks-math.mjs "\$@"
    SH
    chmod +x $out/bin/mxblocks-math
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    MXBLOCKS_MATH_BIN=$out/bin/mxblocks-math pnpm --filter @talaagent/mxblocks-math test
    runHook postInstallCheck
  '';
  meta = {
    description = "LaTeX to PNG (MathJax SVG + resvg) for mxblocks math messages";
    license = lib.licenses.asl20;
    mainProgram = "mxblocks-math";
  };
}
