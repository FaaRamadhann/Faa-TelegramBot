import sys
import os
from rembg import remove, new_session


def main():
    if len(sys.argv) < 3:
        print("Usage: python remove-bg.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    # Model bisa diganti via env REMBG_MODEL (default u2net = cepat, sudah ter-cache).
    # Kualitas lebih bagus: REMBG_MODEL=isnet-general-use (download ~170MB sekali saja).
    # Pilihan lain: u2net_human_seg (khusus orang), silueta.
    model = os.environ.get("REMBG_MODEL", "u2net").strip() or "u2net"

    if not os.path.exists(input_path):
        print(f"Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(input_path, "rb") as f:
            input_data = f.read()

        session = new_session(model)
        output_data = remove(input_data, session=session)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        with open(output_path, "wb") as f:
            f.write(output_data)

        print(f"OK: {output_path} (model={model})")
        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()