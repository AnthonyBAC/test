"""Ejecutar un control estático. Salidas: 0 conforme, 1 umbral excedido, 2 error técnico."""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("ATLAS_CI_OUT", ROOT / "informes-ci")).resolve()
SEMGREP = "semgrep/semgrep@sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3"
SONAR = "sonarqube@sha256:0b3408443fb6a311253de27941b10977c9b977fd53be2265947bfe14161308b8"
SCANNER = "sonarsource/sonar-scanner-cli@sha256:a3f4215076706c95a17a68c19322ee916e40a3acd081a8c1a1e839e0194afa57"
PROJECT = "atlas-ci"
RULES = ROOT / "qa" / "semgrep" / "reglas-atlas.yml"


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def output(args):
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding="utf-8").strip()


def audit(area):
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    proc = subprocess.run([npm, "audit", "--package-lock-only", "--include=dev",
                           "--audit-level=high", "--json"], cwd=ROOT / area, capture_output=True)
    report = json.loads(proc.stdout)
    save(area + ".json", report)
    if proc.returncode not in (0, 1) or "error" in report or "metadata" not in report:
        raise RuntimeError("Auditoría npm incompleta")
    counts = report["metadata"]["vulnerabilities"]
    passed = counts["high"] + counts["critical"] == 0
    return passed, {"npm": output([npm, "--version"]), "paquetes_por_gravedad": counts}


def semgrep():
    # Escanear solo el código de Atlas y montar la configuración por separado.
    args = ["docker", "run", "--rm", "-v", f"{ROOT}/BACKEND/src:/src/BACKEND/src:ro",
            "-v", f"{ROOT}/FRONTEND/src:/src/FRONTEND/src:ro", "-v", f"{RULES}:/rules/atlas.yml:ro",
            "-v", f"{OUT}:/out", SEMGREP, "semgrep", "scan", "--metrics=off", "--strict",
            "--config=/rules/atlas.yml", "--json", "--output=/out/semgrep.json",
            "/src/BACKEND/src", "/src/FRONTEND/src"]
    subprocess.run(args, check=True)
    report = json.loads((OUT / "semgrep.json").read_bytes())
    if report["errors"] or not report["paths"]["scanned"]:
        raise RuntimeError("Semgrep no completó el alcance configurado")
    hits = report["results"]
    high = [r for r in hits if r["extra"]["severity"] == "ERROR"]
    return not high, {"imagen": SEMGREP, "version": report.get("version"), "coincidencias": len(hits),
                      "nivel_ERROR": len(high), "archivos": len(report["paths"]["scanned"])}


def sonar():
    name = "atlas-ci-" + secrets.token_hex(5)
    key = secrets.token_urlsafe(32)
    net = name + "-red"
    output(["docker", "network", "create", net])
    try:
        output(["docker", "run", "-d", "--name", name, "--network", net, "-p", "127.0.0.1::9000",
                "-e", "SONAR_ES_JAVAOPTS=-Xms512m -Xmx512m", SONAR])
        port = output(["docker", "port", name, "9000/tcp"]).rsplit(":", 1)[1]
        url = "http://127.0.0.1:" + port
        def api(route, fields=None, password=key):
            auth = base64.b64encode(("admin:" + password).encode()).decode()
            data = parse.urlencode(fields).encode() if fields is not None else None
            req = request.Request(url + "/api/" + route, data=data, headers={"Authorization": "Basic " + auth})
            with request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None

        for _ in range(120):
            try:
                if api("system/status", password="admin")["status"] == "UP":
                    break
            except (OSError, error.URLError, ValueError):
                pass
            time.sleep(3)
        else:
            raise RuntimeError("SonarQube no estuvo disponible dentro del plazo")
        api("users/change_password", {"login": "admin", "previousPassword": "admin", "password": key}, "admin")
        api("projects/create", {"project": PROJECT, "name": "Atlas CI", "visibility": "private"})
        for lang in ("js", "css"):
            api("qualityprofiles/add_project", {"project": PROJECT, "language": lang, "qualityProfile": "Sonar way comprehensive"})
        gate = "Atlas sin bugs ni vulnerabilidades"
        api("qualitygates/create", {"name": gate})
        for metric in ("bugs", "vulnerabilities"):
            api("qualitygates/create_condition", {"gateName": gate, "metric": metric, "op": "GT", "error": "0"})
        api("qualitygates/select", {"projectKey": PROJECT, "gateName": gate})
        token = api("user_tokens/generate", {"name": name, "type": "PROJECT_ANALYSIS_TOKEN", "projectKey": PROJECT})["token"]
        env = dict(os.environ, SONAR_TOKEN=token)
        subprocess.run(["docker", "run", "--rm", "--network", net, "-e", "SONAR_TOKEN",
                        "-e", f"SONAR_HOST_URL=http://{name}:9000", "-v", f"{ROOT}/BACKEND/src:/src/BACKEND/src:ro",
                        "-v", f"{ROOT}/FRONTEND/src:/src/FRONTEND/src:ro", SCANNER,
                        "-Dsonar.projectKey=" + PROJECT, "-Dsonar.projectBaseDir=/src",
                        "-Dsonar.sources=BACKEND/src,FRONTEND/src", "-Dsonar.exclusions=**/assets/**,**/openapi.json",
                        "-Dsonar.working.directory=/tmp/atlas-scan", "-Dsonar.scm.disabled=true",
                        "-Dsonar.sourceEncoding=UTF-8", "-Dsonar.projectVersion=" + output(["git", "rev-parse", "--short", "HEAD"])],
                       env=env, check=True)
        for _ in range(100):
            task = api("ce/component?component=" + PROJECT)
            if not task.get("queue") and task.get("current", {}).get("status") == "SUCCESS":
                break
            if task.get("current", {}).get("status") in ("FAILED", "CANCELED"):
                raise RuntimeError("SonarQube no procesó el análisis")
            time.sleep(3)
        else:
            raise RuntimeError("Tiempo de procesamiento SonarQube agotado")
        gate_result = api("qualitygates/project_status?projectKey=" + PROJECT)["projectStatus"]
        save("quality-gate.json", gate_result)
        issues = []
        page = 1
        while True:
            batch = api(f"issues/search?componentKeys={PROJECT}&ps=500&p={page}")
            issues.extend(batch["issues"])
            if len(issues) >= batch["paging"]["total"]:
                break
            page += 1
        save("incidencias.json", issues)
        if gate_result["status"] not in ("OK", "ERROR") or len(gate_result["conditions"]) != 2:
            raise RuntimeError("Criterio de aceptación sin evaluar")
        return gate_result["status"] == "OK", {"version": api("system/status")["version"],
               "scanner": SCANNER, "total": len(issues), "condiciones": gate_result["conditions"]}
    finally:
        subprocess.run(["docker", "rm", "-fv", name], stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", net], stdout=subprocess.DEVNULL)


def main():
    control = sys.argv[1]
    OUT.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    report = {"control": control, "inicio_utc": started.isoformat(), "commit": output(["git", "rev-parse", "HEAD"])}
    try:
        if control == "SonarQube":
            passed, detail = sonar()
        elif control == "Semgrep":
            passed, detail = semgrep()
        elif control in ("npm-backend", "npm-frontend"):
            passed, detail = audit(control.split("-")[1].upper())
        else:
            raise ValueError("Control desconocido")
        report.update(estado="Conforme" if passed else "No conforme", detalle=detail)
        code = 0 if passed else 1
    except Exception as exc:
        report.update(estado="Error técnico", error=str(exc))
        code = 2
    report["duracion_s"] = round((datetime.now(timezone.utc) - started).total_seconds(), 2)
    save(control + "-resumen.json", report)
    print(json.dumps(report, ensure_ascii=True), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())

