export const G1 = "(uint256 x,uint256 y)";
export const G2 = "(uint256 xIm,uint256 xRe,uint256 yIm,uint256 yRe)";
export const VK = `(${G1} alpha,${G2} beta,${G2} gamma,${G2} delta,${G1}[] ic)`;
export const GATE0 = `(${VK} vk,(${G1} a,${G2} b,${G1} c,${G1} d) proof,uint256[6] publicInputs)`;
export const GATE1 = `((uint256 n,${G1} commitment,${G1} zH,${G1} query) table,(${G1} g1,${G2} g20,${G2} g21) srs,(${G1} zI,${G1} cI,${G1} u,${G2} w,${G1} h,uint256 v1,uint256 v2,${G1} pi1,${G1} pi2,${G1} pi3) proof,bytes context)`;
export const LINK = `(${G1} pi,${G2} a2,${G2} c1,${G2} c2)`;
export const ROW = `(${G1} a,${G1} u,bytes32 aCompressed,bytes32 uCompressed,bytes32[16] siblings)`;

/** Convert already-validated proof fields to the contract's named ABI tuples. */
export function encodeProofGates(gate0, gate1, link, publicInputs) {
  const {vk, a, b, c, d} = gate0;
  const {table, srs, proof, query, transcript_context_hex} = gate1;
  return {
    gate0: {
      vk: {alpha: vk.alpha_g1, beta: vk.beta_g2, gamma: vk.gamma_g2, delta: vk.delta_g2, ic: vk.gamma_abc_g1},
      proof: {a, b, c, d},
      publicInputs,
    },
    gate1: {
      table: {n: table.n, commitment: table.commitment, zH: table.z_h_g1, query},
      srs: {g1: srs.g1[0], g20: srs.g2[0], g21: srs.g2[1]},
      proof: {
        zI: proof.z_i, cI: proof.c_i, u: proof.u, w: proof.w, h: proof.h,
        v1: proof.v1, v2: proof.v2, pi1: proof.pi1, pi2: proof.pi2, pi3: proof.pi3,
      },
      context: transcript_context_hex,
    },
    link: {pi: link.pi, a2: link.a2, c1: link.c1, c2: link.c2},
  };
}
