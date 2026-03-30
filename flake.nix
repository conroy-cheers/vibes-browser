{
  description = "vibes-browser dev shell and SEA binary";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        nodejs = pkgs.nodejs_24;

        vibes-browser = pkgs.buildNpmPackage {
          pname = "vibes-browser";
          version = "0.1.0";
          src = ./.;

          npmDepsHash = "sha256-pbAEENXhHu1YLj//rP1f0qdGobvLlHF5JJYQTwT59RA=";

          nativeBuildInputs = [
            nodejs
          ];

          buildPhase = ''
            runHook preBuild
            npm run build:sea
            runHook postBuild
          '';

          doCheck = true;
          checkPhase = ''
            runHook preCheck
            npm run test:unit
            runHook postCheck
          '';

          installPhase = ''
            runHook preInstall
            install -Dm755 dist/vibes-browser $out/bin/vibes-browser
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "GPT-backed faux webserver CLI packaged as a single executable";
            mainProgram = "vibes-browser";
            platforms = platforms.linux ++ platforms.darwin;
          };
        };
      in
      {
        packages.default = vibes-browser;
        packages.vibes-browser = vibes-browser;

        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pkgs.chromium
            pkgs.nodePackages.prettier
          ];

          shellHook = ''
            export CHROMIUM_PATH="${pkgs.chromium}/bin/chromium"
            echo "vibes-browser dev shell"
            echo "Run: npm install"
            echo "Run: npm run format"
            echo "Run: npm run test:unit"
            echo "Run: nix build .#vibes-browser"
          '';
        };
      }
    );
}
