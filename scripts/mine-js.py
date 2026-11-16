"""Mine keyword contexts out of minified webpack chunks (research helper)."""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'research', 'asar-src', 'renderer')
KEYWORDS = sys.argv[1:] or ['manifest.json']


def main():
    files = sorted(glob.glob(os.path.join(ROOT, '*.js')))
    for kw in KEYWORDS:
        print('=' * 22, kw, '=' * 22)
        hits = 0
        for path in files:
            text = open(path, encoding='utf-8', errors='ignore').read()
            for match in list(re.finditer(re.escape(kw), text))[:2]:
                start = max(0, match.start() - 200)
                end = min(len(text), match.end() + 260)
                snippet = text[start:end].replace('\n', ' ')
                print(f'  [{os.path.basename(path)} @{match.start()}] {snippet}')
                hits += 1
            if hits >= 14:
                break
        print(f'  ({hits} contexts)\n')


if __name__ == '__main__':
    main()
