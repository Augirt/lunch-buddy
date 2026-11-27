"""从百炼导出的 CSV 安全写入本地 .env，不打印密钥。"""
import csv
import os
from pathlib import Path
import sys
import tempfile


def main():
    if len(sys.argv) != 2:
        raise ValueError("用法：python3 server/configure-key.py 密钥CSV路径")
    source = Path(sys.argv[1])
    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    keys = [cell.strip() for row in rows for cell in row if cell.strip().startswith("sk-")]
    if len(keys) != 1 or any(character.isspace() for character in keys[0]):
        raise ValueError("CSV 必须包含一条完整 API Key。")
    target = Path(__file__).resolve().parent / ".env"
    lines = target.read_text().splitlines() if target.exists() else []
    replacement = "DASHSCOPE_API_KEY=" + keys[0]
    updated = []
    replaced = False
    for line in lines:
        if line.startswith("DASHSCOPE_API_KEY="):
            if not replaced:
                updated.append(replacement)
                replaced = True
        else:
            updated.append(line)
    if not replaced:
        updated.append(replacement)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent, prefix=".env.", delete=False
        ) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            handle.write("\n".join(updated) + "\n")
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print("百炼 API Key 已写入 server/.env，文件权限为 600。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, csv.Error):
        print("配置失败：请确认 CSV 中有一条完整密钥，且本地配置可写。", file=sys.stderr)
        sys.exit(1)
