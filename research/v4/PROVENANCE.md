# Provenance

- Source: private repository SphereXVision, branch research/rigour, commit 2a0f39ee3bbafd5749000579c9d695f66942ea56 (15 Nov 2026). `code/` and `prereg/` are byte-identical to that commit (git archive).
- `results/thresholds.json` and `results/realism_v_pool.json` are byte-identical to the private run outputs (their sha256 match the private FINDINGS log: 7cd118a2…, 931715a1…).
- `results/v_look_result_public.json` is a trimmed copy of `runs/yardstick/V_LOOK_1/v_look_result.json`, original sha256 2e58bc61f87fdd8823952514ab904db7ed9d45ada6f1e22208919ad6dd3c64d0 (also in the private FINDINGS log). Only `real_output.<patch>.unexplained` is withheld; the copy records this in its `_public_copy` field.
- `data/` files are byte-identical copies of the private `prereg/patches.csv` rows for V-1..V-3 (other rows left out), `cache/sia/patch_V-*.csv`, `runs/fetch_V-*.json` and `runs/yardstick/V-*/discard.json`. Each `patch_V-*.csv` sha256 equals the `sia_sha256` column in `patches_V.csv`.
- `FINDINGS_excerpt.md` is trimmed where marked.

## sha256 of every file

```
8d77aaf2bb667ee81db3b987e7efbcf5b92571029f0429e5b4b80ec3f24654bc  ./FINDINGS_excerpt.md
eecf05f8cde8185a8eeccf76a5d95e12dc5303b02630ea5115d0832115e5609d  ./README.md
b2f9e374f0370f9019cc70de41f30443e39d929213bd3cfaaf10617cd80ff113  ./code/pyproject.toml
e80e880cfd7ab4dcd7f768e6ada960afc3248c97a27bb35e8c5d3a3a48e8f18a  ./code/rust/stackkern/Cargo.lock
080cc24c0e1d75e5e92ecb2a38b4c156d1a3dd18e24d814758a651fcff384d2c  ./code/rust/stackkern/Cargo.toml
2c68529375d79ae4f9c1edb2e779aadf0e87fe7fa99ac95cb353e57895d6f993  ./code/rust/stackkern/src/main.rs
9a7033b18f3a60eddbaff106d13c80ff19569b73e5d584f48d8d93629bfec3aa  ./code/scripts/fetch_region.py
c4fc1d5eaea64b12d4a0a10bef0aa7f2611bd020fb62ff289e4d3f3428b02bcb  ./code/scripts/refetch_verify.py
b2b13067cebdc88b52248897e0cb12a6a1d8c3a393843fbd0f0f00c4fbd19c0e  ./code/scripts/save_map_areas.py
8b85b20e318b94357b4d0d936f41af2ab5a0d7f8fa388e3f6c25821d65c8d0e7  ./code/scripts/v1_static.py
205f3e66e41cb332dad89438ec215e82cad8ab2847f315fccf03d6bcfc2a9841  ./code/scripts/v_look_queue.sh
c6791f99e290633f94f7084c8d463b056aa9350fbaa9b48fb71e309344d99246  ./code/scripts/v_look_score.py
3ba5bdfe0b35bf1124f4e813272c4e4d208e64db1bb72fed88f99f6fea61c8ef  ./code/scripts/v_maps_step.sh
a9d769697db9db27bfa69a09cc34ad2e203f124351983e9bdd8909a3729deead  ./code/scripts/yardstick_known.py
8e56e49a3aae26e833deafcdcc798391816b010bd4e91395fba49205a63400b9  ./code/scripts/yardstick_realism.py
17c0b0755db4637b05214e91b1fdb528f6481973f523881749d80501a03709c3  ./code/scripts/yardstick_run.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/__init__.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/catalogs/__init__.py
da5d370413bedfb8de9ea8fa2834190d35f3110a35bb1ec98603465240968ec8  ./code/src/smo/catalogs/catwise.py
9fb6be33266872aec391666309f5e0ec448115ce66ac9c2aaa5589a38418d0ac  ./code/src/smo/catalogs/gaia.py
5564414409c6d3fad753442c6447b5353ca4d7feb079fc0d0be3613270e404bd  ./code/src/smo/catalogs/sources.py
83f0e08139cecb7d3fdae8d805a092b90e96d49ef064678c66afe482479b2a36  ./code/src/smo/catalogs/stack.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/data/__init__.py
425572c34d4a8d92194c68f0ab286f04214c92794af16a76f6d19928ebd3116c  ./code/src/smo/data/calib.py
72fe15e22395560cdbace68068e51acd4b652e98c0c1eee67c083c1e742942cb  ./code/src/smo/data/exposure.py
75d6cf254a3c7e36c0f7bf5df9a63c2626dcd4b6595ad46ee1684997ad3b9770  ./code/src/smo/data/fitsrange.py
7be046d39bb908258e5690b517d60141889766ecac83d6e59bffb9eeb8c0f78a  ./code/src/smo/data/flags.py
6b48b3f206411d56ac853d1010c626bb02bff73d0f15d07ed09f10e141b3128b  ./code/src/smo/data/index.py
eb3de824fb45c14e7595c31ab3cd42883a32403379afe51667eaf711e0a9d091  ./code/src/smo/data/irsa.py
7e39cc564242469278f34066f2b38f8dac7b4f34e6800fb33473fe77a17ee9a7  ./code/src/smo/data/patch.py
779fbe0360ece8bd225aa480af4e1d99505a201e91cf372de9e4f7cd7aa18296  ./code/src/smo/data/s3.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/detect/__init__.py
670bc657d798a9c5c2edafb5f057fdb1535079c1e2aff5571a3264a208e9fd60  ./code/src/smo/detect/kernel.py
390fa93deba3c9e7b3863809fce81e9a67647deee744b7048ca56e2019c928a2  ./code/src/smo/detect/maps.py
0b7e0546753bdcf266c6f6a73017f9ad01473c8ace00bdb38b75f635e7559398  ./code/src/smo/detect/sharpness.py
16760ec333c894a9f9a418585477c5212458b2148c69c6837fcd1d1c7be9ec26  ./code/src/smo/detect/v0.py
a3bdb4f39324c632aea4dcbe0028986b2abce6789c11f78c35a82be7b62a6a77  ./code/src/smo/detect/v2.py
2202c553a79dc3c65624a08e39dfa387c94b47525552c1ed980a5f981ab4de95  ./code/src/smo/detect/v6.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/ephem/__init__.py
b78b0adf14aed5daf0b9007b2bcf911350e5434934ffbb0d2f8372974e2bfa35  ./code/src/smo/ephem/known.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/inject/__init__.py
2f10f642d69bb2028bcb4c87c9f9e05d6eb316f0c53be3d73cae5ee1c0fc224a  ./code/src/smo/inject/clones.py
163669707834f0b333e24e918ad48b6992034e8bb2b67cc60f3a733b86ecfa87  ./code/src/smo/inject/plan.py
80a5df0836fba1b5994d30e060270d5c5508a43c44651edd663bff632c54ec07  ./code/src/smo/inject/render.py
24e2a7a80aa897c9ccb5509052d80c45c96804cc913d09eaedb905363e589934  ./code/src/smo/inject/spectra.py
7988e5a7350e864cd9eac0c90ede8e906018e923ef0325b1b31f38ca714bdd63  ./code/src/smo/inject/truth.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/learn/__init__.py
909f47959cc39e9b031102334d9f70452e63d1e91bc94518f226379353e779d3  ./code/src/smo/learn/data.py
786d4932f7ba7e7b6800440609c98ab7bb1331a41e61cc1b5ca42abf433c1232  ./code/src/smo/learn/load.py
6b0d14738a9a78a9e7f0d03f9ce7634c73848429f8d5588499dbe53b3659a600  ./code/src/smo/learn/model.py
948baa56e50af1e71de15f5d909fc021fe93078a0d2751b68f9890fbae1a733f  ./code/src/smo/learn/prep.py
e8c10e6199afc431b5ff765f9a5992f2bf953e72967552ad63e4b8bec6bf16aa  ./code/src/smo/linalg/__init__.py
9e9284872054279575116277b2bf7d8f64ab3d6b8e0c4f4c5584f8e9b6b5106e  ./code/src/smo/linalg/cholmod.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/methods/__init__.py
63b8453b676320d33d2dc0da6c06ea7231f35755f97d5e9804345b5cb4cd9def  ./code/src/smo/methods/v1.py
52f687a718bf5c51749a690761d69bb4e69f4a358e22ffaae2e28cc398152cf8  ./code/src/smo/provenance.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/scene/__init__.py
2b33314351958743d8e3ff2a8d8d3c4119517cd834d55050ed620ef76580746d  ./code/src/smo/scene/fit.py
2cae7bd1430fe323e1b3b7f3e0b00d907527a20de6fb48dd36abfadd3e85d546  ./code/src/smo/scene/pipeline.py
4a386ea30cab54e6ee01f8e17b5a5093a8d28658bad60c2d1fff9b176d389b8d  ./code/src/smo/scene/psf.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/score/__init__.py
68419f969236889109d86d6ebc60f87f97988e78408a9f2d0cfed53c1e6fa4c0  ./code/src/smo/score/evalsets.py
ec1fac561d6e0fb42ca9af944af5b2c40efb1d1b350a0fbc51ff115cd0f41e27  ./code/src/smo/score/t6.py
b017b8b3ac44b9778be161af2e04d0a23e3675453d3a6a3a733de6b9bf7bbef2  ./code/src/smo/score/yardstick.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./code/src/smo/sky/__init__.py
d4c18e64a2b546f2df7ce9296aa0ae7efc76dff26b1ecaf186ee20c5bc2e72a5  ./code/src/smo/sky/healpix.py
841bd9be3bc296bf7dafa1bfc73725ae92a9e228e15e40ed505abc26afabdc24  ./code/uv.lock
c6899148647428e2d96cd440383f36804e13cfb899869c8b41bfa080d7e042d6  ./data/patch_V-1.csv
2cd25bde7851bba4dd6da89fc5966a3afcf2ff3ce8d46ad8a5351b06b373bef6  ./data/patch_V-2.csv
47b1dc35a19add91b535c1541c6eee6b8298be9b6f7132fb00931dad7921ba8a  ./data/patch_V-3.csv
5028598ab0d769c0422c0b7da67152244c0e23b5f03cd0afa13c735be37b70e3  ./data/patches_V.csv
7c2d96b6e3ce561ec173bb2c23db8aba3e90a7fb8d92728c71329fcf707385fd  ./data/runs/fetch_V-1.json
42f7ea24aa3f55ae3ab0a1c08eac95e749e863631c3ad7e9eb586726650cdefe  ./data/runs/fetch_V-2.json
7f847b63267ffec9dae724b21bcfcc2abbd795a50b0cd0d3bd878ae97d613ec8  ./data/runs/fetch_V-3.json
d04cd4806b06d381d3f6d1417e8cffc640a8e68da9d086d2bd9cea7530ea255c  ./data/runs/yardstick/V-1/discard.json
b0966d92daf47be88d8bb20be713db63b07963006e959175da33e43794def824  ./data/runs/yardstick/V-2/discard.json
3dbe241017a8c46b7e09c063501b768da2b9054cd67a0578b33839d07e8a0462  ./data/runs/yardstick/V-3/discard.json
5015df565c3c0aed9b645a1ae037795a95be15fd530ef09b437fcce623861fcb  ./prereg/METHOD_V4.md
f8542cbc7506705bed78617fd183ba67cdaa3268a8150960922d82225213a2c5  ./prereg/V_LOOK_1.md
b2e28867a7637fb0011f92b1a8679f95ce6671ab1fea386a92684344be872de9  ./prereg/YARDSTICK.md
d8514fc02ad3142f3456340025eb57a9d5b2e20829c206c5ffdc5d3e71b09437  ./prereg/method_v4.json
931715a186922f915c884d476e7c4f8b4114cf9a821738548b9ad44abe07b4a2  ./results/realism_v_pool.json
7cd118a21c045cdc7f155dd5bbb5d90bc858c42de7df1ae03fb0d6721d0f88d2  ./results/thresholds.json
11d3de2d59d9a54e326b70195fbd673311885476c2a296f3101c6c16bfe9b0ba  ./results/v_look_result_public.json
```
