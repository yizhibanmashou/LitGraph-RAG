import sys
import unittest

sys.path.insert(0, "scripts")

from build_dependencies import (  # noqa: E402
    build_global_symbol_index,
    build_dependencies_for_chapter,
    build_storylines,
    formula_sort_key,
    register_formula_senses,
    STORYLINE_TEMPLATE_PHRASES,
)
from symbol_extraction import extract_symbols  # noqa: E402


class SymbolExtractionTest(unittest.TestCase):
    def test_filters_math_operators(self):
        result = extract_symbols(r"E(t)=-\frac{4Np\ln(p)}{1-p}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertNotIn("E", used)
        self.assertNotIn(r"\ln", used)
        self.assertNotIn("E", defined)
        self.assertEqual(defined, {"t"})

    def test_preserves_teacher_compound_notation(self):
        result = extract_symbols(r"F_{ST}=\frac{1}{1+4Nm}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("F_{ST}", used)
        self.assertIn("F_{ST}", defined)
        self.assertNotIn("F", used)
        self.assertNotIn("S", used)
        self.assertNotIn("T", used)

    def test_canonicalizes_bar_without_merging_hat_tilde_or_plain(self):
        bar = extract_symbols(r"\bar{t}_c+\overline{t}_f")
        bar_by_symbol = {item["symbol"]: item for item in bar["symbols_used_detailed"]}
        self.assertEqual(bar_by_symbol[r"\bar{t}_c"]["canonical_latex"], r"\overline{t}_c")
        self.assertEqual(bar_by_symbol[r"\overline{t}_f"]["canonical_latex"], r"\overline{t}_f")
        self.assertNotIn(r"\bar{t}", bar_by_symbol)

        decorated = extract_symbols(r"\hat{p}+\tilde{p}+p")
        exact_keys = {item["symbol"]: item["exact_key"] for item in decorated["symbols_used_detailed"]}
        self.assertEqual(exact_keys[r"\hat{p}"], r"\hat{p}")
        self.assertEqual(exact_keys[r"\tilde{p}"], r"\tilde{p}")
        self.assertEqual(exact_keys["p"], "p")

    def test_function_call_name_is_not_a_variable(self):
        result = extract_symbols(r"F(1-i,2N-1,2N,x)")
        used = {item["symbol"] for item in result["symbols_used"]}

        self.assertNotIn("F", used)

    def test_sigma_morphism_separates_covariance_variance_and_matrix(self):
        result = extract_symbols(r"S=\sigma(w,z)+\sigma_A^2(W)+\mathbf{\Sigma}")
        by_symbol = {item["symbol"]: item for item in result["symbols_used_detailed"]}

        self.assertNotIn(r"\sigma", by_symbol)
        self.assertEqual(by_symbol[r"\sigma_A^2(W)"]["role"], "statistic_variance")
        self.assertEqual(by_symbol[r"\sigma_A^2(W)"]["family_key"], r"\sigma_var")
        self.assertEqual(by_symbol[r"\mathbf{\Sigma}"]["role"], "matrix_symbol")
        self.assertEqual(by_symbol[r"\mathbf{\Sigma}"]["family_key"], r"\Sigma_matrix")

    def test_splits_ocr_glued_symbols_before_extraction(self):
        result = extract_symbols(
            r"R_W=h_W^2S_W={\sigma_A^2(W)\over\sigma^2(W)}{\sigma^2(W)\over\overline{W}}"
        )
        used = {item["symbol"] for item in result["symbols_used"]}

        self.assertIn("h_W^2", used)
        self.assertIn("S_W", used)
        self.assertNotIn("h_W^2S_W", used)
        self.assertNotIn("A^2", used)


class DependencyBuilderTest(unittest.TestCase):
    def test_family_candidates_are_ambiguous_not_prerequisites(self):
        formulas = [
            make_formula("formula_1.1", "1.1", r"F_A=x", 1),
            make_formula("formula_1.2", "1.2", r"F_B=y", 2),
            make_formula("formula_1.3", "1.3", r"F_C=z", 3),
            make_formula("formula_1.4", "1.4", r"G=F_D+1", 4),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter1",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_1.4")

        self.assertFalse(
            any(prereq.get("edge_evidence") == "family_candidate" for prereq in target_dependency["prerequisites"])
        )
        self.assertTrue(any(entry["symbol"] == "F_D" and entry["edge_evidence"] == "family_candidate" for entry in ambiguous))

    def test_exact_and_canonical_edges_remain_accepted(self):
        formulas = [
            make_formula("formula_1.1", "1.1", r"\bar{t}_c=x", 1),
            make_formula("formula_1.2", "1.2", r"z=\overline{t}_c+1", 2),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter1",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_1.2")

        self.assertEqual(target_dependency["prerequisites"][0]["target_id"], "formula_1.1")
        self.assertEqual(target_dependency["prerequisites"][0]["edge_status"], "accepted")
        self.assertEqual(target_dependency["prerequisites"][0]["edge_evidence"], "canonical_match")

    def test_cross_chapter_exact_matches_are_ambiguous_not_main_edges(self):
        chapter1_formulas = [make_formula("formula_1.1", "1.1", r"w_i=W_i/\overline{W}", 1, "chapter1", 1)]
        chapter2_formulas = [make_formula("formula_2.1", "2.1", r"R=w_i+1", 1, "chapter2", 2)]
        chapter1_index, chapter1_senses = register_formula_senses(chapter1_formulas)
        chapter2_index, chapter2_senses = register_formula_senses(chapter2_formulas)
        global_index, global_senses = build_global_symbol_index({"chapter1": chapter1_senses, "chapter2": chapter2_senses})

        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter2",
            chapter2_formulas,
            chapter2_index,
            chapter2_senses,
            global_index,
            global_senses,
            {formula["raw_id"]: formula for formula in chapter1_formulas + chapter2_formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_2.1")

        self.assertFalse(any(prereq.get("target_id") == "formula_1.1" for prereq in target_dependency["prerequisites"]))
        self.assertTrue(
            any(entry["symbol"] == "w_i" and entry["edge_evidence"] == "exact_match" for entry in ambiguous)
        )


class StorylineBuilderTest(unittest.TestCase):
    def test_allele_frequency_excludes_inbreeding_recursion_without_p_entity(self):
        formulas = [
            make_formula("formula_2.8", "2.8", r"\varphi(p_t|p_0)=p_0(1-p_0)", 1, "chapter2", 2),
            make_formula("formula_2.12", "2.12", r"E(t)=-\frac{4Np\ln(p)}{1-p}", 2, "chapter2", 2),
            make_formula("formula_2.3", "2.3", r"f_t=\frac{1}{2N}+\left(1-\frac{1}{2N}\right)f_{t-1}", 3, "chapter2", 2),
        ]
        storylines = build_storylines(formulas)["items"]
        allele_frequency = next(item for item in storylines if item["id"] == "allele-frequency")
        formula_ids = [step["formula_id"] for step in allele_frequency["steps"]]

        self.assertIn("formula_2.8", formula_ids)
        self.assertIn("formula_2.12", formula_ids)
        self.assertNotIn("formula_2.3", formula_ids)

    def test_storylines_are_monotone_template_free_and_complete(self):
        formulas = [
            make_formula("formula_2.8", "2.8", r"\varphi(p_t|p_0)=p_0(1-p_0)", 1, "chapter2", 2),
            make_formula("formula_2.12", "2.12", r"E(t)=-\frac{4Np\ln(p)}{1-p}", 2, "chapter2", 2),
            make_formula("formula_2.3", "2.3", r"f_t=\frac{1}{2N}+\left(1-\frac{1}{2N}\right)f_{t-1}", 3, "chapter2", 2),
            make_formula("formula_2.4a", "2.4a", r"(1-f_t)=\left(1-\frac{1}{2N}\right)(1-f_{t-1})", 4, "chapter2", 2),
            make_formula("formula_2.11a", "2.11a", r"\bar{t}_a(p_0)=-4N[p_0\ln(p_0)+(1-p_0)\ln(1-p_0)]", 5, "chapter2", 2),
            make_formula("formula_3.13", "3.13", r"T=\frac{\sum_i i\ell_i b_i}{\sum_i \ell_i b_i}", 1, "chapter3", 3),
            make_formula("formula_5.8a", "5.8a", r"s_i=(W_i-\overline{W})/\overline{W}=w_i-1", 1, "chapter5", 5),
            make_formula("formula_6.2b", "6.2b", r"q_i'=w_iq_i", 1, "chapter6", 6),
            make_formula("formula_2.18", "2.18", r"D_{AB}=p_{AB}-pq", 6, "chapter2", 2),
            make_formula("formula_2.19", "2.19", r"E(D_t)=[(1-c)\lambda_1]^tD_0", 7, "chapter2", 2),
            make_formula("formula_2.23", "2.23", r"H_{t+1}=H_t(1-2u)+2u", 8, "chapter2", 2),
            make_formula("formula_7.2", "7.2", r"p''=(1-v)p'+u(1-p')", 1, "chapter7", 7),
            make_formula("formula_5.20a", "5.20a", r"p(z)=\exp(-(z-\mu)^2/(2\sigma_z^2))", 2, "chapter5", 5),
            make_formula("formula_6.20a", "6.20a", r"\overline{z}_i=A_i+\overline{\delta}_i", 2, "chapter6", 6),
            make_formula("formula_11.5", "11.5", r"G=\sum_k(\alpha_{ki}+\alpha_{kj}+\delta_{kij})", 1, "chapter11", 11),
            make_formula("formula_13.12a", "13.12a", r"z_{ij}=\mu+G_{ij}+B_i+e_{ij}", 1, "chapter13", 13),
            make_formula("formula_3.1", "3.1", r"f_t=\frac{1}{2N_e}+\left(1-\frac{1}{2N_e}\right)f_{t-1}", 2, "chapter3", 3),
            make_formula("formula_3.3", "3.3", r"N_e=\frac{2N_t-1}{(\sigma_k^2/\mu_k)+\mu_k-1}", 3, "chapter3", 3),
            make_formula("formula_2.22", "2.22", r"r^2=\frac{D^2}{p(1-p)q(1-q)}", 9, "chapter2", 2),
            make_formula("formula_2.29a", "2.29a", r"E(r^2)=\frac{10+\rho+4\theta}{22+13\rho+32\theta+\rho^2}", 10, "chapter2", 2),
            make_formula("formula_6.24c", "6.24c", r"\beta_{A_z|A_w}=\frac{\sigma(A_w,A_z)}{\sigma^2(A_w)}", 3, "chapter6", 6),
        ]
        storylines = build_storylines(formulas)["items"]

        self.assertGreaterEqual(len(storylines), 10)
        for storyline in storylines:
            self.assertGreaterEqual(len(storyline["steps"]), 2, storyline["id"])
            order = [formula_sort_key(step["formula_id"]) for step in storyline["steps"]]
            self.assertEqual(order, sorted(order), storyline["id"])
            for step in storyline["steps"]:
                transition = f"{step['transition_en']} {step['transition_zh']}".lower()
                self.assertFalse(
                    any(phrase.lower() in transition for phrase in STORYLINE_TEMPLATE_PHRASES),
                    f"{storyline['id']} {step['formula_id']}",
                )


def make_formula(
    formula_id: str,
    raw_id: str,
    latex: str,
    position: int,
    chapter_id: str = "chapter1",
    chapter: int = 1,
):
    extracted = extract_symbols(latex)
    return {
        "id": formula_id,
        "raw_id": raw_id,
        "latex": latex,
        "label": f"Formula {raw_id}",
        "chapter_id": chapter_id,
        "chapter": chapter,
        "section": "Synthetic test",
        "subsection": "Synthetic test",
        "position": position,
        "context_text": f"Teacher text for {raw_id}.",
        "source_chunk_id": f"test_{raw_id}",
        "symbols_used_detailed": extracted["symbols_used_detailed"],
        "symbols_defined_detailed": extracted["symbols_defined_detailed"],
        "symbols_used": [item["symbol"] for item in extracted["symbols_used"]],
        "symbols_defined": [item["symbol"] for item in extracted["symbols_defined"]],
    }


if __name__ == "__main__":
    unittest.main()
