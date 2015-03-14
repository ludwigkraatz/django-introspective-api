from django.core.urlresolvers import *
from rest_framework.reverse import *

# TODO: TEST...


def resolve_nested(viewname, current_app):
    for part in viewname.split(':')[:-1:][::-1]:
        if current_app:
            current_app += '.' + part
        else:
            current_app = part
    #print 66, current_app
    return current_app


def get_nested_patterns_resolver(viewname, urlconf=None, args=None, kwargs=None, current_app=None):
    if urlconf is None:
        urlconf = get_urlconf()
    resolver = get_resolver(urlconf)
    args = args or []
    kwargs = kwargs or {}
    if current_app or True:
        current_app = resolve_nested(viewname, current_app)

    if not isinstance(viewname, six.string_types):
        view = viewname
    else:
        parts = viewname.split(':')
        parts.reverse()
        view = parts[0]
        path = parts[1:]

        resolved_path = []
        ns_pattern = ''
        #print 4, urlconf, resolver.app_dict
        while path:
            ns = path.pop()
            #print ns
            # Lookup the name to see if it could be an app identifier
            try:
                app_list = resolver.app_dict[ns]
                #print 5 , app_list
                # Yes! Path part matches an app in the current Resolver
                if current_app and current_app in app_list:
                    # If we are reversing for a particular app,
                    # use that namespace
                    ns = current_app
                elif ns not in app_list:
                    # The name isn't shared by one of the instances
                    # (i.e., the default) so just pick the first instance
                    # as the default.
                    ns = app_list[0]
            except KeyError:
                pass

            try:
                extra, resolver = resolver.namespace_dict[ns]
                resolved_path.append(ns)
                #print 6, ns, extra, resolver
                ns_pattern = ns_pattern + extra
            except KeyError:
                try:
                    extra, resolver = resolver.namespace_dict[current_app]
                    resolved_path.append(current_app)
                    #print 63, current_app, extra, resolver
                    ns_pattern = ns_pattern + extra
                except KeyError as key:
                    if resolved_path:
                        raise NoReverseMatch(
                            "%s is not a registered namespace inside '%s'" %
                            (key, ':'.join(resolved_path)))
                    else:
                        raise NoReverseMatch("%s is not a registered namespace" %
                                             key)
        if ns_pattern:
            #print 7, ns_pattern
            resolver = get_ns_resolver(ns_pattern, resolver)
    #print 99, resolver.reverse_dict
    return resolver, view


def reverse_to_patterns(viewname, args=None, kwargs=None, format=None, **extra):
    if format is not None:
        kwargs = kwargs or {}
        kwargs['format'] = format
    extra['args'] = args or []
    extra['kwargs'] = kwargs or {}

    resolver, view = get_nested_patterns_resolver(viewname, **extra)
    return resolver.reverse_dict.getlist(view)


def reverse_nested(viewname, args=None, kwargs=None, prefix=None, format=None, request=None, **extra):
    if format is not None:
        kwargs = kwargs or {}
        kwargs['format'] = format
    args = extra['args'] = args or []
    kwargs = extra['kwargs'] = kwargs or {}

    if prefix is None:
        prefix = get_script_prefix()
    # TODO: try except reverse with current_app. and fallback to default reverse
    resolver, view = get_nested_patterns_resolver(viewname, **extra)
    url = force_text(iri_to_uri(resolver._reverse_with_prefix(view, prefix, *args, **kwargs)))
    if request:
        return request.build_absolute_uri(url)
    return url
