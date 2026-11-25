"""Watertightness check for STLs written by tests/e2e.mjs:  python tests/check_stl.py test-output"""
import sys, glob, os, zipfile, io, trimesh
d = sys.argv[1] if len(sys.argv) > 1 else "test-output"
ok = True
items = [(f, open(f, "rb").read()) for f in sorted(glob.glob(os.path.join(d, "*.stl")))]
for z in glob.glob(os.path.join(d, "*.zip")):
    with zipfile.ZipFile(z) as zf:
        print(f"{os.path.basename(z)}: {zf.namelist()}")
        items += [(f"{os.path.basename(z)}:{n}", zf.read(n)) for n in zf.namelist() if n.endswith(".stl")]
for name, data in items:
    m = trimesh.load(io.BytesIO(data), file_type="stl")
    good = len(data) > 84 and m.is_watertight and m.is_winding_consistent and m.body_count == 1 and m.volume > 0
    ok &= good
    print(f"{'OK ' if good else 'BAD'} {os.path.basename(name):48s} {len(data):8d} B  tris {len(m.faces):6d}  "
          f"watertight={m.is_watertight} bodies={m.body_count} vol={m.volume:9.1f} mm3  ext={m.extents.round(2).tolist()}")
print("ALL OK" if ok else "FAILURES"); sys.exit(0 if ok else 1)
