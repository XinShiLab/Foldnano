# Foldnano

**Design DNA nanostructures entirely in your browser.** No installation, no
account, and your designs stay on your machine.

**Try it:** [fold.xinshilab.com](https://fold.xinshilab.com) · **Docs:** [fold.xinshilab.com/docs](https://fold.xinshilab.com/docs)

> **Beta.** Foldnano is still under testing: use it with caution and keep copies of important
> designs. You can also run it locally (see [CONTRIBUTING.md](CONTRIBUTING.md)).

![Foldnano editor: 3D structure view next to the strand view of a honeycomb design](static/screenshots/guide/selection-and-highlighting/01-three-views-selection-strand-viewer.webp)

## Features

- **Local-first.** Runs entirely in the browser; designs are kept in local browser storage and
  never leave your machine unless you push them to GitHub.
- **Mix lattices and unlatticed regions.** Square, honeycomb, and freeform regions coexist in a
  single design.
- **Drop-in compatible with cadnano.** Import and export classic cadnano `.json` designs without
  conversion. Native Foldnano designs use `.fn.json`.
- **Built-in 3D view.** Inspect the structure in 3D as you edit, with no export round-trip.
- **Python in the browser.** Script against the live design, or install plugins, with a Python
  runtime (Pyodide) running locally in the page.
- **Export for simulation and ordering.** oxDNA and mrDNA export for simulation, and staple
  sequence CSVs for ordering.
- **Optional GitHub sync.** Save, branch, and compare designs in a GitHub repository.

## Documentation

- **User guide:** getting started, editing tools, views and regions, saving, simulation and export
  ([docs](https://fold.xinshilab.com/docs/guide/getting-started)).
- **Plugin development:** write Python plugins that run in the browser
  ([docs](https://fold.xinshilab.com/docs/plugin-development/plugin-quickstart)).
- **Contributor guide:** architecture, model invariants, and code style
  ([docs](https://fold.xinshilab.com/docs/contributors/contributor-overview)), plus [CONTRIBUTING.md](CONTRIBUTING.md) for local setup.

## Citing Foldnano

If you use Foldnano in your research, please cite it using [CITATION.cff](CITATION.cff) (GitHub
shows a "Cite this repository" button).

## Contributing

Foldnano is maintained by Prof. Xin Shi at the Department of Chemistry, KU Leuven.
[Bug reports](https://github.com/XinShiLab/foldnano/issues) and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to set up a
local development environment. [docs/development-history.md](docs/development-history.md) summarises how the project developed
before this repository's history begins.

## License

- **Code** is released under the [MIT License](LICENSE).
- **Documentation**: the text and images of the documentation site (`src/content/guide/`,
  `src/content/plugin-development/`, `src/content/contributors/` and `static/screenshots/`) are
  © 2025–2026 Xin Shi and Foldnano contributors, licensed under
  [CC BY 4.0](LICENSES/CC-BY-4.0.txt).
- **Code samples and example plugins** in the documentation are MIT, so you can copy them into
  your own code.
- **The Foldnano name and logo** are not licensed under either. A fork or derived site should use
  its own name; saying it is "based on Foldnano" is welcome.

If you reuse the documentation, please credit it like this:

> Based on the [Foldnano documentation](https://fold.xinshilab.com/docs) by Xin Shi and Foldnano
> contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
> Changes were made. (Keep the last sentence only if you changed it.)

Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
