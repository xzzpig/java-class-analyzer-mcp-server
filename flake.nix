{
  description = "Development environment for java-class-analyzer-mcp-server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        lib = pkgs.lib;
        cfrJar = "${pkgs.cfr}/share/java/cfr_0.152.jar";
        mkJavaClassAnalyzerPackage = {
          packageName,
          extraRuntimePackages ? [ ],
          provideJavaHome ? false,
          provideMavenHome ? false,
        }:
          let
            wrapperArgs = [
              ''--set-default NODE_ENV production''
              ''--set-default CFR_PATH "${cfrJar}"''
              ''--prefix CLASSPATH : "${cfrJar}"''
            ]
            ++ lib.optional (extraRuntimePackages != [ ])
              ''--prefix PATH : "${lib.makeBinPath extraRuntimePackages}"''
            ++ lib.optional provideJavaHome
              ''--set-default JAVA_HOME "${pkgs.jdk17}"''
            ++ lib.optional provideMavenHome
              ''--set-default MAVEN_HOME "${pkgs.maven}"'';
          in
          pkgs.buildNpmPackage rec {
            pname = packageName;
            version = "1.0.2";
            src = ./.;

            npmDepsHash = "sha256-OBcgDI66p/FggjJ9qNNsP/KhsxVVsqourmencc/cerQ=";

            nativeBuildInputs = [ pkgs.makeWrapper ];

            postInstall = ''
              mv "$out/bin/java-class-analyzer-mcp" "$out/bin/.java-class-analyzer-mcp-real"
              makeWrapper "$out/bin/.java-class-analyzer-mcp-real" "$out/bin/java-class-analyzer-mcp" ${lib.concatStringsSep " " wrapperArgs}
            '';

            meta = {
              description = "MCP server for Java class file analysis and decompilation";
              homepage = "https://github.com/xzzpig/java-class-analyzer-mcp-server";
              license = lib.licenses.asl20;
              mainProgram = "java-class-analyzer-mcp";
              platforms = lib.platforms.all;
            };
          };
        javaClassAnalyzerBasePackage = mkJavaClassAnalyzerPackage {
          packageName = "java-class-analyzer-mcp-server-base";
        };
        javaClassAnalyzerPackage = mkJavaClassAnalyzerPackage {
          packageName = "java-class-analyzer-mcp-server";
          extraRuntimePackages = [ pkgs.jdk17 pkgs.maven ];
          provideJavaHome = true;
          provideMavenHome = true;
        };
      in {
        packages.base = javaClassAnalyzerBasePackage;
        packages.default = javaClassAnalyzerPackage;

        apps.base = flake-utils.lib.mkApp {
          drv = javaClassAnalyzerBasePackage;
          name = "java-class-analyzer-mcp";
        };

        apps.default = flake-utils.lib.mkApp {
          drv = javaClassAnalyzerPackage;
          name = "java-class-analyzer-mcp";
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            jdk17
            maven
            cfr
          ];

          shellHook = ''
            export JAVA_HOME="${pkgs.jdk17}"
            export MAVEN_HOME="${pkgs.maven}"
            export NODE_ENV="development"
            cfr_store_jar="${cfrJar}"

            if [ -z "''${CFR_PATH:-}" ]; then
              for candidate in "$PWD"/lib/cfr-*.jar "$PWD"/cfr-*.jar; do
                if [ -r "$candidate" ]; then
                  export CFR_PATH="$candidate"
                  break
                fi
              done

              if [ -z "''${CFR_PATH:-}" ] && [ -r "$cfr_store_jar" ]; then
                export CFR_PATH="$cfr_store_jar"
              fi
            fi

            if [ -r "$cfr_store_jar" ]; then
              filtered_classpath=""

              if [ -n "''${CLASSPATH:-}" ]; then
                old_ifs=$IFS
                IFS=:
                for entry in $CLASSPATH; do
                  if [ -n "$entry" ] && [ "$entry" != "$cfr_store_jar" ]; then
                    if [ -n "$filtered_classpath" ]; then
                      filtered_classpath="$filtered_classpath:$entry"
                    else
                      filtered_classpath="$entry"
                    fi
                  fi
                done
                IFS=$old_ifs
              fi

              if [ -n "$filtered_classpath" ]; then
                export CLASSPATH="$cfr_store_jar:$filtered_classpath"
              else
                export CLASSPATH="$cfr_store_jar"
              fi
            fi

            echo "dev shell ready: node $(node -v), npm $(npm -v), java $(java -version 2>&1 | head -n 1)"
            if [ -n "''${CFR_PATH:-}" ]; then
              echo "using CFR_PATH=$CFR_PATH"
            else
              echo "CFR_PATH is unset; place cfr-*.jar in ./lib or export CFR_PATH manually if needed"
            fi
          '';
        };
      });
}
