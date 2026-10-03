import sys
import os

# Make the zip's extracted directory importable
sys.path.insert(0, os.path.dirname(__file__))

import autobreak as ab


def run(ctx):
    import json

    args = ab.DefaultArgs()
    args.nsol      = int(ctx.get_param('nsol', 10))
    args.sequence  = ctx.get_param('scaffold_sequence', 'm13mp18')
    args.rule      = ctx.get_param('break_rules', 'xstap.all3')
    args.func      = ctx.get_param('scoring_function', 'dG:50')
    args.minlength = int(ctx.get_param('min_length_after_break', 21))
    args.maxlength = int(ctx.get_param('max_length_after_break', 60))
    args.dontbreak = int(ctx.get_param('min_length_to_process', 0))
    args.seed      = int(ctx.get_param('seed', 0))
    args.readonly  = bool(ctx.get_param('read_only', False))
    args.verbose   = 0
    args.sort      = False
    args.permute   = False
    args.writeall  = False
    args.npermute  = 0
    args.score     = 'sum'
    args.csv       = True

    cadnano_json = json.loads(ctx.get_part_as_cadnano_json())
    result = ab.run_plugin(cadnano_json, args, ctx)

    if not args.readonly and result['cadnano_json'] is not None:
        import numpy as np
        class _NpEncoder(json.JSONEncoder):
            def default(self, o):
                if isinstance(o, np.integer): return int(o)
                if isinstance(o, np.floating): return float(o)
                if isinstance(o, np.ndarray): return o.tolist()
                return super().default(o)
        ctx.set_result_cadnano_json(json.dumps(result['cadnano_json'], cls=_NpEncoder))
    if result.get('csv'):
        ctx.write_artifact('results.csv', result['csv'])
    if result.get('plots_png'):
        ctx.write_artifact('plots.png', result['plots_png'])
    ctx.set_result(result.get('summary', {}))
