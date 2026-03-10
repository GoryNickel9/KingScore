import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({ currentPage, totalPages, onPageChange, className = '' }: PaginationProps) {
  if (totalPages <= 1) return null

  const getPageNumbers = (): (number | string)[] => {
    const pages: (number | string)[] = []
    
    if (totalPages <= 7) {
      // Mostra tutte le pagine se sono poche
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Mostra con ellipsis
      pages.push(1)
      
      if (currentPage <= 3) {
        // Vicino all'inizio
        pages.push(2, 3, 4, '...', totalPages)
      } else if (currentPage >= totalPages - 2) {
        // Vicino alla fine
        pages.push('...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
      } else {
        // Nel mezzo
        pages.push('...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
      }
    }
    
    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <div className={`flex items-center justify-center space-x-2 ${className}`}>
      {/* Prev button */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={`w-10 h-10 flex items-center justify-center rounded-lg transition text-sm ${
          currentPage === 1
            ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
            : 'bg-slate-700 text-white hover:bg-slate-600'
        }`}
        aria-label="Pagina precedente"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Page numbers */}
      {pageNumbers.map((page, index) => {
        if (page === '...') {
          return (
            <span
              key={`ellipsis-${index}`}
              className="w-10 h-10 flex items-center justify-center text-slate-400 text-sm"
            >
              ...
            </span>
          )
        }

        const pageNum = page as number
        const isCurrentPage = pageNum === currentPage

        return (
          <button
            key={pageNum}
            onClick={() => onPageChange(pageNum)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg transition text-sm ${
              isCurrentPage
                ? 'bg-emerald-500 text-white font-bold'
                : 'bg-slate-700 text-white hover:bg-slate-600'
            }`}
            aria-label={`Pagina ${pageNum}`}
            aria-current={isCurrentPage ? 'page' : undefined}
          >
            {pageNum}
          </button>
        )
      })}

      {/* Next button */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`w-10 h-10 flex items-center justify-center rounded-lg transition text-sm ${
          currentPage === totalPages
            ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
            : 'bg-slate-700 text-white hover:bg-slate-600'
        }`}
        aria-label="Pagina successiva"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}

export default Pagination
