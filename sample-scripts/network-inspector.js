// WhiteNeedle: Network request inspector
// Hooks NSURLSession to log all outgoing HTTP requests

Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
    onEnter: function(self) {
        console.log('[Network] NSURLSession dataTaskWithRequest: called');
    }
});

Interceptor.attach('-[NSURLSession dataTaskWithURL:completionHandler:]', {
    onEnter: function(self) {
        console.log('[Network] NSURLSession dataTaskWithURL: called');
    }
});

// Hook NSURLConnection (legacy)
Interceptor.attach('-[NSURLConnection initWithRequest:delegate:]', {
    onEnter: function(self) {
        console.log('[Network] NSURLConnection initWithRequest: called');
    }
});

console.log('[Network] Network inspector active — monitoring HTTP requests');
