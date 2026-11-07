# The same pnpm workspace/lockfile used by local development and CI.
{
  lib,
  stdenv,
  nodejs,
  pnpm,
  pnpmConfigHook,
  esbuild,
  src,
  pnpmDeps,
}:
stdenv.mkDerivation {
  pname = "mxblocks-element";
  version = "0.1.0";
  inherit src pnpmDeps;
  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    esbuild
  ];
  ESBUILD_BINARY_PATH = lib.getExe esbuild;

  buildPhase = ''
    runHook preBuild
    pnpm --filter @talaagent/mxblocks-element typecheck
    pnpm --filter @talaagent/mxblocks-element build
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm --filter @talaagent/mxblocks-element test
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r packages/mxblocks-element/dist/mxblocks-rich.js packages/mxblocks-element/dist/mxblocks-rich.js.map packages/mxblocks-element/dist/fonts $out/
    cp packages/mxblocks-element/{LICENSE,NOTICE,config.example.json} $out/
    runHook postInstall
  '';
  meta = {
    description = "Element Web module rendering mxblocks rich message blocks";
    license = lib.licenses.asl20;
  };
}
