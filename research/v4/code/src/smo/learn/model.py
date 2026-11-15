"""Option 1b model in MLX: predict a held-out exposure's residual patch from other exposures.

Context tokens (pixels + network features) -> transformer encoder -> a query token built from the
target's network features only -> cross-attention decoder -> per-pixel mean and log-sigma.
Full float32 throughout (no reduced precision).
"""

from __future__ import annotations

import mlx.core as mx
import mlx.nn as nn

from smo.learn.data import N_FEATURES, PATCH


class Block(nn.Module):
    def __init__(self, d: int, heads: int, cross: bool = False):
        super().__init__()
        self.cross = cross
        self.n1 = nn.LayerNorm(d)
        self.n_kv = nn.LayerNorm(d) if cross else None
        self.att = nn.MultiHeadAttention(d, heads)
        self.n2 = nn.LayerNorm(d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))

    def __call__(self, x, kv=None, mask=None):
        h = self.n1(x)
        src = self.n_kv(kv) if self.cross else h
        x = x + self.att(h, src, src, mask=mask)
        return x + self.mlp(self.n2(x))


class PatchPredictor(nn.Module):
    def __init__(self, d: int = 192, heads: int = 6, enc_layers: int = 4, dec_layers: int = 2):
        super().__init__()
        npx = PATCH * PATCH
        self.pix = nn.Sequential(nn.Linear(2 * npx, d), nn.GELU(), nn.Linear(d, d))
        self.feat = nn.Sequential(nn.Linear(N_FEATURES, d), nn.GELU(), nn.Linear(d, d))
        self.qfeat = nn.Sequential(nn.Linear(N_FEATURES, d), nn.GELU(), nn.Linear(d, d))
        self.enc = [Block(d, heads) for _ in range(enc_layers)]
        self.dec = [Block(d, heads, cross=True) for _ in range(dec_layers)]
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, 2 * npx)

    def __call__(self, ctx_pix, ctx_feat, ctx_mask, q_feat):
        B, K = ctx_feat.shape[:2]
        x = self.pix(ctx_pix.reshape(B, K, -1)) + self.feat(ctx_feat)
        # Additive key-padding mask, broadcast over heads and queries.
        neg = mx.where(ctx_mask, 0.0, -1e9).astype(mx.float32)
        m_enc = neg[:, None, None, :]
        for blk in self.enc:
            x = blk(x, mask=m_enc)
        q = self.qfeat(q_feat)[:, None, :]
        for blk in self.dec:
            q = blk(q, kv=x, mask=m_enc)
        out = self.head(self.norm(q[:, 0]))
        mu, log_sigma = mx.split(out, 2, axis=-1)
        return mu.reshape(B, PATCH, PATCH), mx.clip(log_sigma, -4.0, 4.0).reshape(B, PATCH, PATCH)


def gaussian_nll(mu, log_sigma, tgt, tgt_mask):
    z = (tgt - mu) * mx.exp(-log_sigma)
    per = 0.5 * z * z + log_sigma
    w = tgt_mask.astype(mx.float32)
    return mx.sum(per * w) / mx.maximum(mx.sum(w), 1.0)
