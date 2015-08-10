define([], function () {
    
    function log(log, type, args) {
        var prefix,
            use_console=false;
        if (! args instanceof Array) {
            args = [args]
        }
        if (!log || log === console) {
            log = console;
            use_console = true;
        }
        var selected_log;
        if (typeof log != 'function') {
            if (typeof log[type] == 'function') {
                selected_log = log[type]
            }else if (typeof log['debug'] == 'function') {
                selected_log = log['debug']
                prefix = '(' + type +')'
            }else if (typeof log['log'] == 'function') {
                selected_log = log['log']
                prefix = '(' + type +')'
            }else{
                for (var key in log) {
                    if (typeof log[key] == 'function') {
                        selected_log = log[key];
                    }
                }
                if (!selected_log) {
                    selected_log = console.log
                    use_console = true;
                }
                prefix = '(' + type +')'
            }
        }else{
            selected_log = log;
        }
        if (prefix) {
            args.push(prefix)
        }
        if (use_console) {
            // otherwise might throw Illegal invocation Error
            selected_log.apply(console, args)
        }else{
            selected_log.apply(null, args)
        }
    }
    
    return log
})