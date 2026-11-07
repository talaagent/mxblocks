{
  description = "mxblocks: rich message blocks for Matrix bots (Rust crate, Element module, math renderer)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      imports = [ inputs.treefmt-nix.flakeModule ];

      perSystem =
        {
          config,
          self',
          pkgs,
          lib,
          ...
        }:
        let
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./Cargo.toml
              ./Cargo.lock
              ./README.md
              ./CHANGELOG.md
              ./LICENSE
              ./NOTICE
              ./crates
            ];
          };
          jsSrc = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json
              ./pnpm-workspace.yaml
              ./pnpm-lock.yaml
              ./turbo.json
              ./packages
              ./crates/mxblocks/tests/fixtures/rich
              ./LICENSE
              ./NOTICE
            ];
          };
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "mxblocks-pnpm-deps";
            version = "0.1.0";
            src = jsSrc;
            fetcherVersion = 5;
            hash = "sha256-oPzRUen72Wz9k2zO9hyLViLl5A9UO4p0Vw5p5XStrUY=";
          };
        in
        {
          # The crate (a library: $out is empty). `cargo test` runs in checkPhase.
          packages.mxblocks = pkgs.rustPlatform.buildRustPackage {
            pname = "mxblocks";
            version = (lib.importTOML ./Cargo.toml).workspace.package.version;
            inherit src;
            cargoLock.lockFile = ./Cargo.lock;
            # The workspace: mxblocks and crates/* (tex, asks, tools).
            cargoBuildFlags = [ "--workspace" ];
            cargoTestFlags = [ "--workspace" ];
            meta = {
              description = "Rich message blocks for Matrix bots";
              license = lib.licenses.asl20;
            };
          };
          # The Element Web module ($out/mxblocks-rich.js; ./packages/mxblocks-element/default.nix).
          packages.element-module = pkgs.callPackage ./packages/mxblocks-element {
            src = jsSrc;
            inherit pnpmDeps;
          };
          # LaTeX -> PNG for math messages (`mxblocks-math render`; ./packages/mxblocks-math/default.nix).
          packages.mxblocks-math = pkgs.callPackage ./packages/mxblocks-math {
            src = jsSrc;
            inherit pnpmDeps;
          };
          packages.default = self'.packages.element-module;

          # cargo test
          checks.mxblocks = self'.packages.mxblocks;
          # typecheck + node tests + bundle
          checks.element-module = self'.packages.element-module;
          # node tests against the installed program
          checks.mxblocks-math = self'.packages.mxblocks-math;
          # clippy with warnings denied, from the same vendored deps.
          checks.clippy = self'.packages.mxblocks.overrideAttrs (old: {
            pname = "mxblocks-clippy";
            nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.clippy ];
            buildPhase = ''
              runHook preBuild
              cargo clippy --offline --workspace --all-targets -- -D warnings
              runHook postBuild
            '';
            doCheck = false;
            installPhase = "touch $out";
          });
          checks.rustfmt =
            pkgs.runCommand "mxblocks-rustfmt"
              {
                nativeBuildInputs = [
                  pkgs.cargo
                  pkgs.rustfmt
                ];
              }
              ''
                cp -r ${src} src && chmod -R u+w src && cd src
                cargo fmt --all --check
                touch $out
              '';
          # No private ids in the tree (generic scripts/privacy-patterns only; the
          # private patterns live outside the repo, see scripts/privacy-check).
          checks.privacy =
            pkgs.runCommand "mxblocks-privacy-check" { nativeBuildInputs = [ pkgs.python3 ]; }
              ''
                src=${lib.cleanSource ./.}
                python3 $src/scripts/privacy-check $src
                touch $out
              '';

          # `nix fmt`: Nix, Rust and the TypeScript / JavaScript.
          treefmt = {
            projectRootFile = "flake.nix";
            programs.nixfmt.enable = true;
            programs.rustfmt.enable = true;
            programs.prettier = {
              enable = true;
              includes = [
                "packages/mxblocks-element/src/**/*.ts"
                "packages/mxblocks-element/src/**/*.tsx"
                "packages/mxblocks-element/test/**/*.ts"
                "packages/mxblocks-math/src/**/*.mjs"
                "packages/mxblocks-math/test/**/*.mjs"
              ];
              settings.printWidth = 100;
            };
          };

          devShells.default = pkgs.mkShell {
            name = "mxblocks";
            MXBLOCKS_MATH_RESVG = lib.getExe pkgs.resvg;
            MXBLOCKS_MATH_FONT_DIR = "${pkgs.dejavu_fonts}/share/fonts/truetype";
            packages = [
              pkgs.cargo
              pkgs.rustc
              pkgs.clippy
              pkgs.rustfmt
              pkgs.cargo-nextest
              pkgs.rust-analyzer
              pkgs.nodejs
              pkgs.pnpm
              pkgs.resvg
              pkgs.python3
              config.treefmt.build.wrapper
            ];
          };
        };
    };
}
